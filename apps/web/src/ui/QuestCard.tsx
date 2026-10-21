"use client";

import { useState, useEffect, useMemo, useCallback, type CSSProperties } from "react";
import { PixelImg, ICON } from "@/ui/PixelIcons";
import {
  PIX, PANEL_FRAME, THIN_FRAME, FrameBtn, Arrow,
  HUD_ACCENT, HUD_CYAN, HUD_MUTED, HUD_TEXT,
} from "@/ui/hudFrame";
import { chamferBox } from "@/ui/chamfer";
import { profileManager } from "@/game/config/profileManager";
import { progressionBus } from "@/game/progression/progressionBus";
import { isVariantUnlocked } from "@/game/config/wardrobeUnlocks";
import { getVariant, type LayerCategory } from "@/game/config/paperDoll";
import {
  allQuestProgress, type QuestContext, type QuestDef, type QuestProgress,
} from "@/game/quests/questRegistry";

/**
 * The quest list, as a HUD card beside the hunt.
 *
 * Built on the same shell so the two read as one interface: the panel art, the
 * lime accent, the square frame buttons, and a collapse that leaves a strip
 * rather than disappearing. Mobile gets the thin frame and lives on the icon
 * rail, where the panels are mutually exclusive so a small screen never stacks
 * windows.
 *
 * It shows the thing the quests never could: how far along you are. Guarana's
 * chain is seven NPCs and the only feedback used to be the unlock toast at the
 * end.
 */

type Row = { def: QuestDef; progress: QuestProgress };

// ── Data ────────────────────────────────────────────────────────────────────

/**
 * Re-reads the quests whenever something that could move one happens.
 *
 * Three events matter and all three already exist: an unlock (several steps
 * are "do you own the reward"), an NPC conversation (the chains), and a
 * profile update (the streak). Polling would be the alternative and this card
 * can sit open for a whole session.
 */
function useQuestRows(wallet: string | null): Row[] {
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const offs = [
      progressionBus.on("outfit-unlocked", bump),
      progressionBus.on("npc-visited", bump),
      progressionBus.on("profile-updated", bump),
    ];
    return () => offs.forEach((off) => off());
  }, [bump]);

  return useMemo(() => {
    const ctx: QuestContext = {
      profile: profileManager.get(),
      owns: (c: LayerCategory, id: string) => {
        const variant = getVariant(c, id);
        return !!variant && isVariantUnlocked(wallet, c, variant);
      },
    };
    const rows = allQuestProgress(ctx);
    // Unfinished first, and within that the closest to done, so the card opens
    // on what the player is actually in the middle of.
    return rows.sort((a, b) => {
      if (a.progress.complete !== b.progress.complete) return a.progress.complete ? 1 : -1;
      return b.progress.done / b.progress.total - a.progress.done / a.progress.total;
    });
    // `tick` is the subscription's only job: it is what makes this recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, tick]);
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Bar({ pct }: { pct: number }) {
  return (
    <div style={chamferBox(3, { background: "rgba(183,233,40,0.12)", height: 4, width: "100%" })}>
      <div style={{ width: `${Math.round(pct * 100)}%`, height: "100%", background: HUD_ACCENT }} />
    </div>
  );
}

function Step({ label, done }: { label: string; done: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, lineHeight: 1.5 }}>
      <span style={{
        width: 6, height: 6, flexShrink: 0,
        background: done ? HUD_CYAN : "transparent",
        border: done ? "none" : `1px solid ${HUD_MUTED}`,
      }} />
      <span style={{
        fontSize: 7, color: done ? HUD_CYAN : HUD_MUTED,
        textDecoration: done ? "line-through" : "none",
      }}>{label}</span>
    </div>
  );
}

function QuestRow({ row, open, onToggle }: {
  row: Row; open: boolean; onToggle: () => void;
}) {
  const { def, progress } = row;
  const multi = def.steps.length > 1;
  return (
    <div style={chamferBox(6, {
      background: progress.complete ? "rgba(183,233,40,0.07)" : "rgba(255,255,255,0.03)",
      border: `1px solid ${progress.complete ? "rgba(183,233,40,0.22)" : "rgba(255,255,255,0.06)"}`,
      padding: "6px 8px",
    })}>
      {/* Every quest is a dropdown, one step or seven: the steps are the
          detail, and a card that shows them all at once stops being a list. */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          cursor: "pointer", userSelect: "none",
        }}
      >
        {progress.complete
          ? <PixelImg src={ICON.star} size={12} />
          : <span style={{ fontSize: 7, color: HUD_MUTED, flexShrink: 0 }}>
              {progress.done}/{progress.total}
            </span>}
        <span style={{
          flex: 1, minWidth: 0, fontSize: 7, lineHeight: 1.5,
          color: progress.complete ? HUD_ACCENT : HUD_TEXT,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{def.title}</span>
        <Arrow dir={open ? "up" : "down"} />
      </div>

      {/* A bar earns its row only when there is a middle to be in. On one step
          it is a worse tick than the count already beside the title. */}
      {!progress.complete && multi && (
        <div style={{ marginTop: 5 }}><Bar pct={progress.done / progress.total} /></div>
      )}

      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
          {progress.steps.map(({ step, done }) => (
            <Step key={step.id} label={step.label} done={done} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestList({ rows, wallet, maxHeight }: {
  rows: Row[]; wallet: string | null; maxHeight: number;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (!wallet) {
    return (
      <div style={{ fontSize: 7, color: HUD_MUTED, lineHeight: 1.6, textAlign: "center", padding: "6px 0" }}>
        CONNECT WALLET<br />TO TRACK QUESTS
      </div>
    );
  }
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 5,
      // minHeight 0 and a shrinking flex basis: on a phone the stack above the
      // controls has a ceiling, and the list is what gives when the hunt card
      // is also open.
      maxHeight, minHeight: 0, flex: "0 1 auto", overflowY: "auto", overflowX: "hidden",
      // No scrollbar styling here on purpose. globals.css dresses every bar in
      // the retro chrome already, and a `scrollbar-width` set inline would
      // override the Firefox fallback it is careful about. The same file hides
      // the bar entirely under (pointer: coarse), which leaves the phone with
      // a clean swipe.
      //
      // pan-y so the swipe belongs to this list rather than being taken for a
      // drag by whatever is underneath it.
      touchAction: "pan-y",
      WebkitOverflowScrolling: "touch",
    } as CSSProperties}>
      {rows.map((row) => (
        <QuestRow
          key={row.def.id}
          row={row}
          open={open === row.def.id}
          onToggle={() => setOpen((id) => (id === row.def.id ? null : row.def.id))}
        />
      ))}
    </div>
  );
}

function Header({ done, total, collapsed, onCollapse, compact }: {
  done: number; total: number; collapsed: boolean; onCollapse: () => void; compact: boolean;
}) {
  return (
    <div
      onClick={onCollapse}
      style={{
        display: "flex", alignItems: "center", gap: compact ? 6 : 8,
        cursor: "pointer", userSelect: "none",
        ...(compact ? {} : {
          padding: "11px 13px",
          borderBottom: collapsed ? "none" : "1px solid rgba(183,233,40,0.1)",
        }),
      }}
    >
      {/* icon_tasks1: a picture, not a button. The framed icon_tasks is the rail's button. */}
      <PixelImg src={ICON.tasks} size={compact ? 18 : 26} />
      <span style={{
        fontFamily: PIX, fontSize: compact ? 8 : 7, color: HUD_ACCENT,
        letterSpacing: 0.5, flex: 1, lineHeight: 1.4, whiteSpace: "nowrap",
      }}>QUESTS</span>
      <span style={{ fontFamily: PIX, fontSize: 8, color: HUD_MUTED, flexShrink: 0 }}>
        {done}/{total}
      </span>
      <FrameBtn
        size={compact ? 24 : 22}
        title={collapsed ? "Expand" : "Collapse"}
        onClick={onCollapse}
      >
        <Arrow dir={compact ? (collapsed ? "right" : "left") : (collapsed ? "up" : "down")} />
      </FrameBtn>
    </div>
  );
}

// ── The card ────────────────────────────────────────────────────────────────

export default function QuestCard({ wallet }: { wallet: string | null }) {
  const [isTouch, setIsTouch] = useState(false);

  // Collapsed to begin with on DESKTOP, where this card stacks under the hunt
  // and two open panels can run past a short window. The hunt is the one that
  // has to stay visible, because it is timed.
  //
  // On a phone the rail button already IS the collapse: the card only exists
  // once it is tapped, so starting collapsed there would cost a second tap to
  // see anything at all.
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    setIsTouch(touch);
    if (touch) setCollapsed(false);
  }, []);
  const rows = useQuestRows(wallet);
  const done = rows.filter((r) => r.progress.complete).length;

  const toggle = () => setCollapsed((v) => !v);

  if (isTouch) {
    if (collapsed) {
      return (
        <div
          onClick={toggle}
          style={{
            ...THIN_FRAME, padding: 3, width: 140, boxSizing: "border-box",
            fontFamily: PIX, cursor: "pointer", userSelect: "none",
          } as CSSProperties}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PixelImg src={ICON.tasks} size={20} />
            <span style={{ flex: 1, fontSize: 10, color: "#fff" }}>{done}/{rows.length}</span>
            <FrameBtn size={28} title="Expand" onClick={toggle}>
              <Arrow dir="right" />
            </FrameBtn>
          </div>
        </div>
      );
    }
    return (
      <div style={{
        ...THIN_FRAME, padding: 5, width: 300, boxSizing: "border-box",
        fontFamily: PIX, color: HUD_TEXT,
        // A column that can shrink: see QuestList.
        display: "flex", flexDirection: "column", minHeight: 0,
      } as CSSProperties}>
        <Header done={done} total={rows.length} collapsed={false} onCollapse={toggle} compact />
        <div style={{ marginTop: 6, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {/* Short enough that the city stays visible behind the panel. */}
          <QuestList rows={rows} wallet={wallet} maxHeight={200} />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      ...PANEL_FRAME,
      width: 224,
      fontFamily: PIX,
      color: HUD_TEXT,
      overflow: "hidden",
    } as CSSProperties}>
      <Header done={done} total={rows.length} collapsed={collapsed} onCollapse={toggle} compact={false} />
      {!collapsed && (
        <div style={{ padding: "12px 13px" }}>
          <QuestList rows={rows} wallet={wallet} maxHeight={260} />
        </div>
      )}
    </div>
  );
}
