"use client";

/**
 * Sol Mechs — battle overlay.
 *
 * Follows the house minigame convention: the scene renders on a <canvas>
 * owned by BattleRenderer, with the HUD and controls as DOM on top.
 *
 * The flow is hangar → workshop → battle → result. The hangar shows each
 * mech as the build that will actually deploy — its saved loadout, not the
 * stock chassis — so what the roster advertises and what the engine fights
 * are the same thing. The battle is driven entirely by the pure engine, so
 * swapping LocalAIOpponent for a network provider later changes only where
 * player 2's actions come from.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { MiniGameComponentProps, MiniGameBaseContext } from "../types";
import {
  createBattle, resolveRound, forfeit, availableMoves, legalTargets, createUnit,
  type BattleState, type BattleAction, type BattleEvent, type PlayerSide,
  type RoundActions,
} from "@/game/solmechs/engine/BattleEngine";
import { BattleRenderer, splitIntoBeats, CANVAS_W, CANVAS_H } from "@/game/solmechs/render/BattleRenderer";
import { preloadAll, preloadBuild, drawMech, DOLL_WIDTH, DOLL_HEIGHT } from "@/game/solmechs/render/MechPaperDoll";
import { LocalAIOpponent } from "@/game/solmechs/opponent/LocalAIOpponent";
import { MATRICES, PRESET_BUILDS } from "@/game/solmechs/data/catalog";
import { recordResult, loadHangar, getBuild } from "@/game/solmechs/hangar";
import Workshop from "./Workshop";
import MainMenu from "./MainMenu";
import { BattleLog } from "./BattleLog";
import { useChessClock, ClockBar } from "./ClockBar";
import { DEFAULT_CLOCK } from "@/game/solmechs/data/clock";
import { C, T, SP, R, MONO, backdrop, panel, eyebrow, button, W, PANEL_HEIGHT } from "./theme";
import TeamBuilder from "./TeamBuilder";
import TeamBattleScreen from "./TeamBattleScreen";
import { validateTeam, type TeamBuild } from "@/game/solmechs/data/team";
import { LIMB_SLOTS, type MechId, type ModuleSlot, type MechBuild, type MoveDefinition } from "@/game/solmechs/data/types";

type Phase = "menu" | "hangar" | "workshop" | "squad" | "team-battle" | "battle" | "result";

/** Paper-doll scale for the roster cards. */
const CARD_SCALE = 2;

const SLOT_LABEL: Record<ModuleSlot, string> = {
  rightArm: "R.Arm",
  leftArm: "L.Arm",
  lowerBody: "Legs",
  matrix: "MATRIX",
};

const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

/**
 * Unity's per-slot glyphs (Interface guidance/arena/log_*.png). Used on the
 * target buttons so picking a limb is a picture of that limb rather than an
 * abbreviation the player has to decode mid-fight.
 */
const SLOT_ICON: Record<ModuleSlot, string> = {
  matrix:    "/assets/minigames/sol-mechs/ui/slotmini-matrix.png",
  rightArm:  "/assets/minigames/sol-mechs/ui/slotmini-rightarm.png",
  leftArm:   "/assets/minigames/sol-mechs/ui/slotmini-leftarm.png",
  lowerBody: "/assets/minigames/sol-mechs/ui/slotmini-legs.png",
};

/**
 * Battle layout.
 *
 * The HUD columns flank the arena instead of stacking above it. `flex-basis`
 * with `flexWrap` on the parent is what makes that collapse gracefully: on a
 * narrow window the columns wrap under the canvas rather than crushing it.
 */
const sxBattle: Record<string, React.CSSProperties> = {
  /**
   * No wrap. Wrapping let the row grow taller than its flex allowance, which
   * is how the arena ended up overflowing the panel; the HUD columns shrink
   * instead, and their min-width keeps them legible.
   */
  arenaRow: {
    flex: 1, minHeight: 0, display: "flex", gap: SP.md, alignItems: "stretch",
  },
  arenaBox: {
    // `relative` is what lets the canvas resolve 100% against a real height.
    position: "relative", flex: "4 1 320px", minWidth: 220, minHeight: 0,
    borderRadius: R.md, border: `2px solid ${C.line}`,
    overflow: "hidden", background: C.ink,
  },
  hudColumn: {
    flex: "1 1 170px", minWidth: 140, maxWidth: 260,
    display: "flex", flexDirection: "column", justifyContent: "center",
    background: C.ink, border: `1px solid ${C.line}`,
    borderRadius: R.md, padding: SP.md,
  },
};

function SlotIcon({ slot, size = 20 }: { slot: ModuleSlot; size?: number }) {
  return (
    <img
      src={SLOT_ICON[slot]}
      alt=""
      style={{ ...PIXELATED, height: size, width: "auto", display: "block", flexShrink: 0 }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

export default function SolMechsBattle({ onResult, onClose }: MiniGameComponentProps<MiniGameBaseContext>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BattleRenderer | null>(null);
  const aiRef = useRef(new LocalAIOpponent("veteran"));
  // The renderer and the AI both need the current state outside React's render
  // cycle, so it lives in a ref as well as in state.
  const stateRef = useRef<BattleState | null>(null);

  const [phase, setPhase] = useState<Phase>("menu");
  const [playerMech, setPlayerMech] = useState<MechId>("titan");
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** True while the renderer is mid-sequence; blocks input and the AI. */
  const [animating, setAnimating] = useState(false);
  const [pendingMove, setPendingMove] = useState<{ slot: Exclude<ModuleSlot, "matrix">; moveIndex: number } | null>(null);
  const [playerTeam, setPlayerTeam] = useState<TeamBuild | null>(null);

  /**
   * Both clocks run while the round is being chosen and stop while it
   * resolves — the player is not charged for watching the animation.
   */
  const thinking: PlayerSide[] =
    phase === "battle" && battle?.status.kind === "active" && !animating && !busy
      ? ["p1", "p2"]
      : [];

  const { clock, credit } = useChessClock({
    config: DEFAULT_CLOCK,
    thinking,
    paused: phase !== "battle" || battle?.status.kind === "finished",
    onTimeout: (side) => {
      const current = stateRef.current;
      if (!current || current.status.kind === "finished") return;
      const { state: ended, events } = forfeit(current, side, "timeout");
      pushLog(events.map((e) => describeRef.current(e, ended)).filter((l): l is string => l !== null).reverse());
      stateRef.current = ended;
      setBattle(ended);
    },
  });

  /**
   * The 3v3 opponent. Fixed rather than random so a squad can be tuned
   * against a known wall, and verified legal at module scope — an illegal
   * rival would be a rule the player is held to and the AI isn't.
   */
  const rivalTeam: TeamBuild = useMemo(() => {
    const team: TeamBuild = {
      mechs: [
        PRESET_BUILDS.arclight,
        PRESET_BUILDS.heartcore,
        { matrixCode: "M02", rightArm: "RA01", leftArm: "LA01", lowerBody: "IN01" },
      ],
    };
    const check = validateTeam(team);
    if (!check.ok) console.error("[SolMechs] rival squad is illegal:", check.messages);
    return team;
  }, []);

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
      case "defeat-cause":
        return e.cause === "matrix-destroyed"
          ? `  ** ${name(e.side)}'s Matrix is destroyed.`
          : `  ** ${name(e.side)} has lost every limb.`;
      case "forfeit":
        return `  ** ${name(e.side)} ran out of time.`;
      case "victory": return `=== ${name(e.winner)} wins! ===`;
      case "rejected": return `  ${e.reason}.`;
      default: return null;
    }
  }, []);

  const describeRef = useRef(describe);
  describeRef.current = describe;

  const submitRound = useCallback(async (action: BattleAction | null): Promise<void> => {
    const current = stateRef.current;
    if (!current) return;

    setBusy(true);
    // Submitting hands back the increment — the Fischer half of the clock.
    credit("p1");
    credit("p2");
    // The rival chooses from the PRE-round state and never sees the player's
    // pick — that is what makes this simultaneous rather than the rival simply
    // answering. Both commitments then resolve together in speed order.
    const rivalAction = await aiRef.current.chooseAction(current, "p2");

    const round: RoundActions = { p1: action, p2: rivalAction };
    const { state: nextState, events } = resolveRound(current, round);

    // Effects are picked from the pre-round moves; afterwards the limb that
    // fired may already be gone.
    const p1Move = action ? current.p1.parts[action.sourceSlot]?.moves[action.moveIndex] : undefined;
    const p2Move = rivalAction ? current.p2.parts[rivalAction.sourceSlot]?.moves[rivalAction.moveIndex] : undefined;

    const lines = events
      .map((e) => describe(e, nextState))
      .filter((l): l is string => l !== null);
    pushLog(lines.reverse());

    const renderer = rendererRef.current;
    renderer?.setState(nextState);
    // One beat per attacker, chained — the faster mech's hit plays out in full
    // before the slower one begins.
    renderer?.playRound(splitIntoBeats(events, { p1: p1Move, p2: p2Move }));

    stateRef.current = nextState;
    setBattle(nextState);

    const wait = renderer?.remainingMs() ?? 0;
    setAnimating(true);
    window.setTimeout(() => { setAnimating(false); setBusy(false); }, Math.max(wait, 200));
  }, [describe, pushLog, credit]);

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

  // ==================== MAIN MENU ====================
  if (phase === "menu") {
    const h = loadHangar();
    return (
      <MainMenu
        wins={h.wins}
        losses={h.losses}
        onClose={onClose}
        onChoose={(choice) => {
          if (choice === "pve") setPhase("hangar");
          else if (choice === "squad") setPhase("squad");
          else setPhase("workshop");
        }}
      />
    );
  }

  // ==================== SQUAD (3v3) ====================
  if (phase === "squad") {
    return (
      <TeamBuilder
        onClose={() => setPhase("menu")}
        onDeploy={(team) => { setPlayerTeam(team); setPhase("team-battle"); }}
      />
    );
  }

  if (phase === "team-battle" && playerTeam) {
    return (
      <TeamBattleScreen
        playerTeam={playerTeam}
        enemyTeam={rivalTeam}
        onClose={() => setPhase("menu")}
        onFinished={(playerWon, s) => {
          recordResult(playerWon);
          void onResult({
            success: playerWon,
            metadata: {
              game: "sol-mechs",
              mode: "3v3",
              turns: s.history.length,
              // The action list is what an on-chain verifier replays, so it
              // travels with the outcome exactly as in the 1v1 path.
              actions: s.history,
            },
          });
        }}
      />
    );
  }

  // ==================== WORKSHOP ====================
  if (phase === "workshop") {
    return (
      <Workshop
        initialMech={playerMech}
        // Follow the chassis the player left the Workshop on, so hitting
        // DEPLOY next deploys what they were just editing.
        onSaved={(mech) => setPlayerMech(mech)}
        onMechChange={(mech) => setPlayerMech(mech)}
        onClose={() => setPhase("menu")}
      />
    );
  }

  // ==================== HANGAR ====================
  if (phase === "hangar") {
    const hangar = loadHangar();
    return (
      <Shell onClose={onClose} onBack={() => setPhase("menu")} title="Sol Mechs" subtitle="SELECT MECH" fit wide>
        <p style={{ color: C.text, fontSize: T.lead, margin: 0, flexShrink: 0, fontWeight: 600 }}>
          Pick the mech you&apos;ll deploy. Two ways to win a fight:
        </p>
        <p style={{ color: C.body, fontSize: T.body, margin: "0 0 4px", lineHeight: 1.6 }}>
          break an <strong style={{ color: C.body }}>arm</strong> to expose the Matrix and blow the core —
          or strip <strong style={{ color: C.body }}>all three limbs</strong>. Each limb you take also
          costs them the stats that limb was providing.
        </p>
        {/* Only the roster scrolls, so DEPLOY stays reachable without hunting
            for it at the bottom of a list. */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingRight: 2,
          display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))",
          gap: 10, alignContent: "start",
        }}>
          {MATRICES.map((m) => {
            // Cards render the SAVED build, not the stock chassis. Showing base
            // chassis stats here was what made a customized mech look like it
            // was being ignored: the hangar advertised one thing and the
            // battle deployed another.
            const build = getBuild(hangar, m.id);
            const custom = hangar.builds[m.id] !== undefined;
            return (
              <MechCard
                key={m.matrixCode}
                matrixName={m.matrixName}
                role={m.role}
                build={build}
                custom={custom}
                selected={playerMech === m.id}
                onSelect={() => setPlayerMech(m.id)}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          <button
            onClick={() => setPhase("workshop")}
            style={{
              padding: "12px 18px", background: "none", color: C.dim,
              border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 13,
              fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            WORKSHOP
          </button>
          <button
            onClick={() => startBattle(playerMech)}
            style={{
              flex: 1, padding: "12px 0", background: C.teal,
              color: C.ink, border: "none", borderRadius: 8, fontSize: 15,
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
  const canAct = battle.status.kind === "active" && !busy && !animating;
  const moves = availableMoves(battle.p1);
  const targets = legalTargets(battle.p2);
  const selectedMove = pendingMove
    ? battle.p1.parts[pendingMove.slot].moves[pendingMove.moveIndex]
    : null;

  const onTargetPicked = (slot: ModuleSlot) => {
    if (!pendingMove || !canAct) return;
    void submitRound({
      side: "p1",
      sourceSlot: pendingMove.slot,
      moveIndex: pendingMove.moveIndex,
      targetSlot: slot,
    });
    setPendingMove(null);
  };

  return (
    <Shell onClose={onClose} title="Sol Mechs" subtitle="BATTLE" fit wide>
      {/* Arena centre stage, HUD flanking it. Stacking the two status blocks
          above the canvas wasted the width and squeezed the arena into a
          letterbox; wrapping is what keeps this honest on a narrow window. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: SP.md, flexShrink: 0 }}>
        <ClockBar clock={clock} config={DEFAULT_CLOCK} thinking={thinking} side="p1" label="You" />
        <span style={{ ...eyebrow, color: C.faint }}>Round {battle.round}</span>
        <ClockBar clock={clock} config={DEFAULT_CLOCK} thinking={thinking} side="p2" label="Rival" align="right" />
      </div>

      <div style={sxBattle.arenaRow}>
        <div style={sxBattle.hudColumn}>
          <MechStatus state={battle} side="p1" />
        </div>

        <div style={sxBattle.arenaBox}>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%", objectFit: "contain",
                imageRendering: "pixelated", display: "block",
              }}
          />
        </div>

        <div style={sxBattle.hudColumn}>
          <MechStatus state={battle} side="p2" />
        </div>
      </div>

      {phase === "result" && battle.status.kind === "finished" ? (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{
            fontSize: T.display, fontWeight: 800, letterSpacing: 1,
            color: battle.status.winner === "p1" ? C.teal : C.bad,
          }}>
            {battle.status.winner === "p1" ? "VICTORY" : "DEFEAT"}
          </div>
          <div style={{ color: C.dim, fontSize: T.body, margin: "6px 0 18px" }}>
            {battle.history.length} rounds
            {clock.p1 <= 0 || clock.p2 <= 0 ? " · decided on time" : ""}
          </div>
          <button onClick={() => setPhase("menu")} style={btnStyle(C.teal)}>MAIN MENU</button>
          <button onClick={onClose} style={{ ...btnStyle(C.line), color: "#fff", marginLeft: 8 }}>LEAVE</button>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {!canAct ? (
            <div style={{ color: C.dim, fontSize: T.body, textAlign: "center", padding: "18px 0" }}>
              {battle.p2.name} is choosing…
            </div>
          ) : !pendingMove ? (
            <>
              <div style={{ ...eyebrow, marginBottom: SP.sm }}>Select action</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {moves.map((o) => (
                  <button
                    key={`${o.slot}-${o.moveIndex}`}
                    onClick={() => {
                      // Self-target moves have exactly one sensible target —
                      // the limb they came from — so they skip target picking.
                      if (o.move.targetType === "self") {
                        void submitRound({ side: "p1", sourceSlot: o.slot, moveIndex: o.moveIndex, targetSlot: o.slot });
                      } else {
                        setPendingMove({ slot: o.slot, moveIndex: o.moveIndex });
                      }
                    }}
                    style={btnStyle(C.raised, true)}
                  >
                    <div style={{ fontWeight: 800, fontSize: T.body }}>{o.move.name}</div>
                    <div style={{ fontSize: T.small, color: C.dim, marginTop: 2 }}>
                      {SLOT_LABEL[o.slot]} · {o.move.baseDamage > 0 ? `${o.move.baseDamage} ${o.move.damageType}` : o.move.effect || "Effect"}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ ...eyebrow, marginBottom: SP.sm }}>
                TARGET FOR {selectedMove?.name.toUpperCase()}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {targets.map((slot) => (
                  <button
                    key={slot}
                    onClick={() => onTargetPicked(slot)}
                    style={{ ...btnStyle(slot === "matrix" ? "#5c1830" : C.raised, true), display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <SlotIcon slot={slot} size={slot === "matrix" ? 18 : 24} />
                    <div>
                      <div style={{ fontWeight: 800, fontSize: T.body }}>{SLOT_LABEL[slot]}</div>
                      <div style={{ fontSize: T.small, color: C.dim, marginTop: 2 }}>
                        {battle.p2.partStatuses[slot].currentHP} HP
                      </div>
                    </div>
                  </button>
                ))}
                <button onClick={() => setPendingMove(null)} style={btnStyle(C.line, true)}>
                  <div style={{ fontWeight: 800, fontSize: T.body }}>Back</div>
                </button>
              </div>
              {!targets.includes("matrix") && (
                <div style={{ fontSize: T.small, color: C.warn, marginTop: SP.sm }}>
                  Matrix is sealed — destroy an arm to expose it.
                </div>
              )}
            </>
          )}
        </div>
      )}

      <BattleLog lines={log} turns={battle.history.length} initiallyCollapsed />
    </Shell>
  );
}

/**
 * One roster entry: the assembled mech as it will actually deploy.
 *
 * Draws the saved build's paper doll and its real assembled totals, so the
 * card and the battle can't disagree. `custom` badges a build the player
 * edited, which is the feedback that was missing when the hangar listed bare
 * chassis stats.
 */
function MechCard({ matrixName, role, build, custom, selected, onSelect }: {
  matrixName: string;
  role: string;
  build: MechBuild;
  custom: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    preloadBuild(build);
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !ref.current) return;
    const c = ref.current;
    const loop = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      drawMech(ctx, build, { x: 0, y: 0, scale: CARD_SCALE });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [build]);

  // Totals come from the engine's own assembly, never a local re-derivation.
  const stats = useMemo(() => {
    try { return createUnit(matrixName, build).totalStats; } catch { return null; }
  }, [matrixName, build]);

  return (
    <button
      onClick={onSelect}
      style={{
        background: selected ? C.raised : C.panel,
        border: `2px solid ${selected ? C.teal : C.line}`,
        borderRadius: 8, padding: 10, cursor: "pointer", textAlign: "left",
        color: "#fff", display: "flex", flexDirection: "column", gap: 4,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <strong style={{ fontSize: T.lead, color: C.text }}>{matrixName}</strong>
        {custom && (
          <span style={{
            fontSize: T.eyebrow, color: C.teal, border: "1px solid " + C.teal,
            borderRadius: R.sm, padding: "2px 7px", letterSpacing: 1, flexShrink: 0, fontWeight: 700,
          }}>CUSTOM</span>
        )}
      </div>
      <div style={{ fontSize: T.small, color: C.teal, fontWeight: 600 }}>{role}</div>
      {/* Sized by height, not width: the doll box is padded wide by the arm
          sockets, so a width-driven canvas made every card far taller than the
          mech inside it and pushed the roster off screen. */}
      <canvas
        ref={ref}
        width={DOLL_WIDTH * CARD_SCALE}
        height={DOLL_HEIGHT * CARD_SCALE}
        style={{
          imageRendering: "pixelated", height: 150, width: "auto",
          maxWidth: "100%", display: "block", margin: "0 auto",
        }}
      />
      {stats && (
        <div style={{ fontSize: T.small, color: C.body, lineHeight: 1.75, fontFamily: MONO }}>
          HP {stats.HP} · SPD {stats.SPD}<br />
          ATK {stats.ATK} · DEF {stats.DEF}<br />
          ENG {stats.ENG} · SYS {stats.SYS}
        </div>
      )}
    </button>
  );
}

/**
 * Battle-screen buttons. A thin adapter over the shared `button()` so the call
 * sites stay readable while the tokens stay in one place.
 */
function btnStyle(bg: string, block = false): React.CSSProperties {
  const tone: "primary" | "danger" | "neutral" =
    bg === C.teal ? "primary" : bg === "#5c1830" ? "danger" : "neutral";
  return {
    ...button(tone),
    textAlign: "left",
    minWidth: block ? 132 : undefined,
    padding: block ? "10px 14px" : "12px 22px",
  };
}

function MechStatus({ state, side, align }: { state: BattleState; side: PlayerSide; align?: "right" }) {
  const unit = side === "p1" ? state.p1 : state.p2;
  return (
    <div style={{ flex: 1, textAlign: align ?? "left" }}>
      <div style={{ fontSize: T.lead, fontWeight: 800, color: C.text, marginBottom: 3 }}>{unit.name}</div>
      <Bar
        label="MATRIX"
        current={unit.partStatuses.matrix.currentHP}
        max={unit.partStatuses.matrix.maxHP}
        color={C.teal}
      />
      {LIMB_SLOTS.map((slot) => (
        <Bar
          key={slot}
          label={SLOT_LABEL[slot]}
          current={unit.partStatuses[slot].currentHP}
          max={unit.partStatuses[slot].maxHP}
          color={C.blue}
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
      <span style={{ fontSize: T.eyebrow, color: dead ? C.faint : C.dim, width: 54, fontFamily: MONO, fontWeight: 700 }}>
        {label}
      </span>
      {/* 9-slice of the Unity bar frame (MechEditorSprites/Workshop/bar.png),
          the same chrome the Workshop's stat bars use. */}
      <div style={{
        flex: 1,
        borderStyle: "solid", borderWidth: "2px 4px 5px",
        borderImage: "url(/assets/minigames/sol-mechs/ui/bar.png) 20 60 80 fill / 2px 4px 5px / 0 stretch",
      }}>
        <div style={{ height: 9, background: "#000", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: dead ? "#4a2030" : color, transition: "width .25s" }} />
        </div>
      </div>
      <span style={{ fontSize: T.small, color: C.body, width: 38, fontFamily: MONO, textAlign: "right" }}>{current}</span>
    </div>
  );
}

/**
 * Overlay chrome, in two layouts.
 *
 *  - `fit` (battle): fixed height, nothing scrolls, and the canvas shrinks
 *    into whatever space is left so the arena is never cropped.
 *  - default (hangar, result): the content is a LIST, so it scrolls. Forcing
 *    the fit layout on it just clipped the roster with no way to reach the
 *    buttons underneath.
 */
function Shell({ children, onClose, onBack, title, subtitle = "", fit = false, wide = false }: {
  children: React.ReactNode;
  onClose: () => void;
  /** When present, shows a back arrow to the previous screen. */
  onBack?: () => void;
  title: string;
  subtitle?: string;
  /** Fill the height and never scroll — for the battle, where the canvas shrinks. */
  fit?: boolean;
  /** Take the battle-sized width. Menus and lists stay narrow. */
  wide?: boolean;
}) {
  return (
    <div style={backdrop}>
      <div style={{
        ...panel(wide ? W.battle : W.narrow),
        padding: SP.lg,
        height: fit ? PANEL_HEIGHT : undefined,
        display: "flex", flexDirection: "column", gap: SP.md, overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: SP.md, flexShrink: 0 }}>
          {onBack && (
            <button onClick={onBack} aria-label="Back" style={{ ...button("ghost"), padding: "8px 12px", fontSize: T.lead }}>
              &lsaquo;
            </button>
          )}
          <img
            src="/assets/minigames/sol-mechs/ui/logo.png"
            alt={title}
            style={{ imageRendering: "pixelated", height: 34, width: "auto", display: "block" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span style={{ ...eyebrow, marginRight: "auto" }}>{subtitle}</span>
          <button onClick={onClose} aria-label="Close" style={{
            background: "none", border: "none", color: C.dim,
            fontSize: 30, cursor: "pointer", lineHeight: 1, padding: 4,
          }}>&times;</button>
        </div>

        <div style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: SP.md,
          // Only the fit layout keeps everything on screen; list layouts scroll
          // vertically and never sideways.
          overflowY: fit ? "hidden" : "auto",
          overflowX: "hidden",
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}
