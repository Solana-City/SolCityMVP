"use client";

/**
 * Sol Mechs — battle overlay.
 *
 * Follows the house minigame convention: the scene renders on a <canvas>
 * owned by BattleRenderer, with the HUD and controls as DOM on top.
 *
 * The flow is hangar → battle → result. Selecting a mech in the hangar picks
 * a preset build; the battle itself is driven entirely by the pure engine, so
 * swapping LocalAIOpponent for a network provider later changes only where
 * player 2's actions come from.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { MiniGameComponentProps, MiniGameBaseContext } from "../types";
import {
  createBattle, resolveAction, availableMoves, legalTargets,
  type BattleState, type BattleAction, type BattleEvent, type PlayerSide,
} from "@/game/solmechs/engine/BattleEngine";
import { BattleRenderer, CANVAS_W, CANVAS_H } from "@/game/solmechs/render/BattleRenderer";
import { preloadAll, preloadBuild } from "@/game/solmechs/render/MechPaperDoll";
import { LocalAIOpponent } from "@/game/solmechs/opponent/LocalAIOpponent";
import { MATRICES, PRESET_BUILDS } from "@/game/solmechs/data/catalog";
import { recordResult, loadHangar, getBuild } from "@/game/solmechs/hangar";
import Workshop from "./Workshop";
import { LIMB_SLOTS, type MechId, type ModuleSlot } from "@/game/solmechs/data/types";

type Phase = "hangar" | "workshop" | "battle" | "result";

const SLOT_LABEL: Record<ModuleSlot, string> = {
  rightArm: "R.Arm",
  leftArm: "L.Arm",
  lowerBody: "Legs",
  matrix: "MATRIX",
};

const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

export default function SolMechsBattle({ onResult, onClose }: MiniGameComponentProps<MiniGameBaseContext>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BattleRenderer | null>(null);
  const aiRef = useRef(new LocalAIOpponent("veteran"));
  // The renderer and the AI both need the current state outside React's render
  // cycle, so it lives in a ref as well as in state.
  const stateRef = useRef<BattleState | null>(null);

  const [phase, setPhase] = useState<Phase>("hangar");
  const [playerMech, setPlayerMech] = useState<MechId>("titan");
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingMove, setPendingMove] = useState<{ slot: Exclude<ModuleSlot, "matrix">; moveIndex: number } | null>(null);

  useEffect(() => { preloadAll(); }, []);

  // Escape closes from anywhere except mid-resolution.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const pushLog = useCallback((lines: string[]) => {
    // Newest first, capped — the panel is short and scrolling it during a
    // fight pulls attention off the mechs.
    setLog((prev) => [...lines, ...prev].slice(0, 40));
  }, []);

  const describe = useCallback((e: BattleEvent, state: BattleState): string | null => {
    const name = (s: PlayerSide) => (s === "p1" ? state.p1.name : state.p2.name);
    switch (e.type) {
      case "attack": return `${name(e.side)} used ${e.moveName}.`;
      case "damage": return `  ${name(e.side)}'s ${SLOT_LABEL[e.targetSlot]} took ${e.amount} (${e.percent.toFixed(0)}%).`;
      case "heal": return `  ${name(e.side)}'s ${SLOT_LABEL[e.targetSlot]} recovered ${e.amount}.`;
      case "stage": return `  ${name(e.side)}'s ${SLOT_LABEL[e.targetSlot]} ${e.stat} ${e.delta > 0 ? "rose" : "fell"}.`;
      case "part-broken": return `  ** ${e.partName} destroyed!`;
      case "matrix-unlocked": return `  ** ${name(e.side)}'s MATRIX is exposed!`;
      case "victory": return `=== ${name(e.winner)} wins! ===`;
      case "rejected": return `  ${e.reason}.`;
      default: return null;
    }
  }, []);

  const applyAction = useCallback((action: BattleAction): BattleState | null => {
    const current = stateRef.current;
    if (!current) return null;
    const { state: nextState, events } = resolveAction(current, action);

    const lines = events.map((e) => describe(e, nextState)).filter((l): l is string => l !== null);
    pushLog(lines.reverse());

    rendererRef.current?.playEvents(events);
    rendererRef.current?.setState(nextState);
    stateRef.current = nextState;
    setBattle(nextState);
    return nextState;
  }, [describe, pushLog]);

  // Hand the turn to the AI whenever it becomes p2's move.
  useEffect(() => {
    if (phase !== "battle" || !battle) return;
    if (battle.status.kind !== "active" || battle.status.turn !== "p2") return;

    let cancelled = false;
    setBusy(true);
    (async () => {
      const action = await aiRef.current.chooseAction(battle, "p2");
      if (cancelled) return;
      if (action) applyAction(action);
      setBusy(false);
    })();
    return () => { cancelled = true; setBusy(false); };
  }, [phase, battle, applyAction]);

  // Settle once someone wins.
  useEffect(() => {
    if (!battle || battle.status.kind !== "finished") return;
    setPhase("result");
    const won = battle.status.winner === "p1";
    recordResult(won);
    void onResult({
      success: won,
      metadata: {
        game: "sol-mechs",
        playerMech,
        opponentMech: battle.p2.matrix.id,
        turns: battle.history.length,
        // The full action list is what an on-chain verifier replays to confirm
        // this result, so it travels with the outcome.
        actions: battle.history,
      },
    });
  }, [battle, onResult, playerMech]);

  const startBattle = useCallback((mech: MechId) => {
    // Opponent is any mech other than the player's, so a match never opens as
    // a mirror of the build you just picked.
    const others = MATRICES.filter((m) => m.id !== mech);
    const foe = others[Math.floor(Math.random() * others.length)].id;

    // The player fights their Workshop loadout; the AI fights stock, so a
    // customized build is measured against a known baseline.
    const playerBuild = getBuild(loadHangar(), mech);
    preloadBuild(playerBuild);
    preloadBuild(PRESET_BUILDS[foe]);

    const fresh = createBattle(playerBuild, PRESET_BUILDS[foe], {
      p1Name: MATRICES.find((m) => m.id === mech)!.matrixName,
      p2Name: MATRICES.find((m) => m.id === foe)!.matrixName,
      // Local play opens on the faster mech, so building for SPD pays off.
      firstMove: "speed",
    });
    stateRef.current = fresh;
    setBattle(fresh);
    setLog([`${fresh.p1.name} vs ${fresh.p2.name} — battle start.`]);
    setPendingMove(null);
    setPhase("battle");
  }, []);

  // Renderer lives as long as the battle canvas is mounted.
  useEffect(() => {
    if (phase !== "battle") return;
    const canvas = canvasRef.current;
    const initial = stateRef.current;
    if (!canvas || !initial) return;

    const renderer = new BattleRenderer(canvas, initial);
    rendererRef.current = renderer;
    renderer.start();
    return () => { renderer.destroy(); rendererRef.current = null; };
  }, [phase]);

  // ==================== WORKSHOP ====================
  if (phase === "workshop") {
    return (
      <Workshop
        initialMech={playerMech}
        // Follow the chassis the player left the Workshop on, so hitting
        // DEPLOY next deploys what they were just editing.
        onSaved={(mech) => setPlayerMech(mech)}
        onClose={() => setPhase("hangar")}
      />
    );
  }

  // ==================== HANGAR ====================
  if (phase === "hangar") {
    return (
      <Shell onClose={onClose} title="SOL MECHS — HANGAR">
        <p style={{ color: "#9d8fc4", fontSize: 13, margin: "0 0 16px" }}>
          Pick your chassis. Destroy an enemy arm to expose their Matrix — that&apos;s the only way to win.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          {MATRICES.map((m) => {
            const selected = playerMech === m.id;
            return (
              <button
                key={m.matrixCode}
                onClick={() => setPlayerMech(m.id)}
                style={{
                  background: selected ? "#2d1b5e" : "#1a1030",
                  border: `2px solid ${selected ? "#14f195" : "#3d2a63"}`,
                  borderRadius: 8, padding: 12, cursor: "pointer", textAlign: "left", color: "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 15 }}>{m.matrixName}</strong>
                  <span style={{ fontSize: 10, color: "#9d8fc4" }}>{m.matrixCode}</span>
                </div>
                <div style={{ fontSize: 11, color: "#14f195", marginBottom: 6 }}>{m.role}</div>
                <div style={{ fontSize: 11, color: "#c3b8e0", lineHeight: 1.5 }}>
                  HP {m.baseStats.HP} · ATK {m.baseStats.ATK} · DEF {m.baseStats.DEF}<br />
                  ENG {m.baseStats.ENG} · SYS {m.baseStats.SYS} · SPD {m.baseStats.SPD}
                </div>
                <div style={{ fontSize: 10, color: "#7a68a8", marginTop: 6 }}>
                  {m.passive1} · {m.passive2}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button
            onClick={() => setPhase("workshop")}
            style={{
              padding: "12px 18px", background: "none", color: "#9d8fc4",
              border: "1px solid #3d2a63", borderRadius: 8, fontSize: 13,
              fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            WORKSHOP
          </button>
          <button
            onClick={() => startBattle(playerMech)}
            style={{
              flex: 1, padding: "12px 0", background: "#14f195",
              color: "#0d0718", border: "none", borderRadius: 8, fontSize: 15,
              fontWeight: 700, cursor: "pointer",
            }}
          >
            DEPLOY
          </button>
        </div>
      </Shell>
    );
  }

  if (!battle) return null;

  // ==================== BATTLE / RESULT ====================
  const myTurn = battle.status.kind === "active" && battle.status.turn === "p1" && !busy;
  const moves = availableMoves(battle.p1);
  const targets = legalTargets(battle.p2);
  const selectedMove = pendingMove
    ? battle.p1.parts[pendingMove.slot].moves[pendingMove.moveIndex]
    : null;

  const onTargetPicked = (slot: ModuleSlot) => {
    if (!pendingMove || !myTurn) return;
    applyAction({
      side: "p1",
      sourceSlot: pendingMove.slot,
      moveIndex: pendingMove.moveIndex,
      targetSlot: slot,
    });
    setPendingMove(null);
  };

  return (
    <Shell onClose={onClose} title="SOL MECHS">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <MechStatus state={battle} side="p1" />
        <MechStatus state={battle} side="p2" align="right" />
      </div>

      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ ...PIXELATED, width: "100%", borderRadius: 8, border: "2px solid #3d2a63", display: "block" }}
      />

      {phase === "result" && battle.status.kind === "finished" ? (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{
            fontSize: 24, fontWeight: 800,
            color: battle.status.winner === "p1" ? "#14f195" : "#ff5468",
          }}>
            {battle.status.winner === "p1" ? "VICTORY" : "DEFEAT"}
          </div>
          <div style={{ color: "#9d8fc4", fontSize: 12, margin: "4px 0 14px" }}>
            {battle.history.length} actions
          </div>
          <button onClick={() => setPhase("hangar")} style={btnStyle("#14f195")}>BACK TO HANGAR</button>
          <button onClick={onClose} style={{ ...btnStyle("#3d2a63"), color: "#fff", marginLeft: 8 }}>LEAVE</button>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {!myTurn ? (
            <div style={{ color: "#9d8fc4", fontSize: 13, textAlign: "center", padding: "14px 0" }}>
              {battle.p2.name} is choosing…
            </div>
          ) : !pendingMove ? (
            <>
              <div style={{ fontSize: 11, color: "#9d8fc4", marginBottom: 6 }}>SELECT ACTION</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {moves.map((o) => (
                  <button
                    key={`${o.slot}-${o.moveIndex}`}
                    onClick={() => {
                      // Self-target moves have exactly one sensible target —
                      // the limb they came from — so they skip target picking.
                      if (o.move.targetType === "self") {
                        applyAction({ side: "p1", sourceSlot: o.slot, moveIndex: o.moveIndex, targetSlot: o.slot });
                      } else {
                        setPendingMove({ slot: o.slot, moveIndex: o.moveIndex });
                      }
                    }}
                    style={btnStyle("#2d1b5e", true)}
                  >
                    <div style={{ fontWeight: 700 }}>{o.move.name}</div>
                    <div style={{ fontSize: 10, color: "#9d8fc4" }}>
                      {SLOT_LABEL[o.slot]} · {o.move.baseDamage > 0 ? `${o.move.baseDamage} ${o.move.damageType}` : o.move.effect || "Effect"}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "#9d8fc4", marginBottom: 6 }}>
                TARGET FOR {selectedMove?.name.toUpperCase()}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {targets.map((slot) => (
                  <button key={slot} onClick={() => onTargetPicked(slot)} style={btnStyle(slot === "matrix" ? "#7a1f3d" : "#2d1b5e", true)}>
                    <div style={{ fontWeight: 700 }}>{SLOT_LABEL[slot]}</div>
                    <div style={{ fontSize: 10, color: "#9d8fc4" }}>
                      {battle.p2.partStatuses[slot].currentHP} HP
                    </div>
                  </button>
                ))}
                <button onClick={() => setPendingMove(null)} style={btnStyle("#3d2a63", true)}>
                  <div style={{ fontWeight: 700 }}>Back</div>
                </button>
              </div>
              {!targets.includes("matrix") && (
                <div style={{ fontSize: 10, color: "#7a68a8", marginTop: 6 }}>
                  Matrix is sealed — destroy an arm to expose it.
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{
        marginTop: 10, height: 82, overflowY: "auto", background: "#120a24",
        border: "1px solid #2a1c4d", borderRadius: 6, padding: 8,
        fontSize: 11, fontFamily: "monospace", color: "#c3b8e0", lineHeight: 1.6,
      }}>
        {log.map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </Shell>
  );
}

function btnStyle(bg: string, block = false): React.CSSProperties {
  return {
    background: bg, color: "#fff", border: "1px solid #3d2a63", borderRadius: 6,
    padding: block ? "8px 12px" : "10px 18px", cursor: "pointer", fontSize: 12,
    textAlign: "left", minWidth: block ? 108 : undefined, fontWeight: 600,
  };
}

function MechStatus({ state, side, align }: { state: BattleState; side: PlayerSide; align?: "right" }) {
  const unit = side === "p1" ? state.p1 : state.p2;
  return (
    <div style={{ flex: 1, textAlign: align ?? "left" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{unit.name}</div>
      <Bar
        label="MATRIX"
        current={unit.partStatuses.matrix.currentHP}
        max={unit.partStatuses.matrix.maxHP}
        color="#14f195"
      />
      {LIMB_SLOTS.map((slot) => (
        <Bar
          key={slot}
          label={SLOT_LABEL[slot]}
          current={unit.partStatuses[slot].currentHP}
          max={unit.partStatuses[slot].maxHP}
          color="#6b8cff"
        />
      ))}
    </div>
  );
}

function Bar({ label, current, max, color }: { label: string; current: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, current / max) * 100 : 0;
  const dead = current <= 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
      <span style={{ fontSize: 9, color: dead ? "#5a4a7a" : "#9d8fc4", width: 46, fontFamily: "monospace" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 6, background: "#1a1030", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: dead ? "#5a2a3a" : color, transition: "width .25s" }} />
      </div>
      <span style={{ fontSize: 9, color: "#7a68a8", width: 30, fontFamily: "monospace" }}>{current}</span>
    </div>
  );
}

function Shell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(5,2,12,.88)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "#150c2b", border: "2px solid #3d2a63", borderRadius: 12,
        padding: 16, width: "min(680px,100%)", maxHeight: "100%", overflowY: "auto",
        fontFamily: "system-ui,sans-serif",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: "#14f195", letterSpacing: 1 }}>{title}</h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#9d8fc4", fontSize: 20,
            cursor: "pointer", lineHeight: 1, padding: 0,
          }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
