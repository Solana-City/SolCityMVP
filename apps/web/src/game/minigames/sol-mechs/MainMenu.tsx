"use client";

/**
 * Sol Mechs — main menu.
 *
 * The entry point used to be the mech roster: the player was dropped into a
 * grid of five mechs with no idea what pressing one would do. Choosing a MODE
 * is the first real decision, so it comes first, and each row says what it is
 * before you commit.
 *
 * Every row is the same button: the Unity `UI/button3.png` frame — which the
 * original uses for its menu buttons too — with one gradient plate for the
 * label. An earlier pass dropped Unity's `Interface guidance/Menus` label
 * sprites in here, but that set was never designed as a set: the four modes we
 * have are different widths, heights, colours and slant angles, so the column
 * read as four unrelated buttons however they were scaled.
 */
import { useEffect } from "react";
import { C, T, SP, R, MONO, PIXELATED, backdrop, panel, eyebrow, labelPlate, actionButton, W } from "./theme";

const UI = "/assets/minigames/sol-mechs/ui";

export type MenuChoice = "pve" | "squad" | "workshop";

export interface MainMenuProps {
  onChoose: (choice: MenuChoice) => void;
  onClose: () => void;
  wins: number;
  losses: number;
}

export default function MainMenu({ onChoose, onClose, wins, losses }: MainMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const played = wins + losses;

  return (
    <div style={backdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...panel(W.narrow), padding: `${SP.xl}px ${SP.xl}px ${SP.lg}px`, overflowY: "auto", overflowX: "hidden" }}>
        <button onClick={onClose} style={sx.close} aria-label="Close">×</button>

        <header style={sx.hero}>
          <img
            src={`${UI}/logo.png`}
            alt="Sol Mechs"
            style={{ ...PIXELATED, width: "min(250px, 64%)", height: "auto", display: "block" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <p style={sx.tagline}>
            Modular mech duels. Break a limb and you take its stats with it.
          </p>
          {played > 0 && (
            <div style={sx.record}>
              <span style={{ color: C.good }}>{wins}W</span>
              <span style={{ color: C.faint }}>·</span>
              <span style={{ color: C.bad }}>{losses}L</span>
            </div>
          )}
        </header>

        <div style={eyebrow}>Choose a mode</div>
        <div style={sx.list}>
          <MenuRow
            label="ARENA PvE"
            desc="Duel one rival mech. Best place to learn the rules."
            onClick={() => onChoose("pve")}
          />
          <MenuRow
            label="SQUAD 3v3"
            desc="Three mechs, one at a time. Substituting is your whole round."
            onClick={() => onChoose("squad")}
          />
          <MenuRow
            label="SOL MECH EDITOR"
            desc="Swap parts across chassis and save a loadout."
            onClick={() => onChoose("workshop")}
          />
          <MenuRow
            label="ARENA PvP"
            desc="Season ladder. One pass, an exclusive mech, USDC by placement."
            badge="SOON"
            disabled
          />
        </div>
      </div>
    </div>
  );
}

function MenuRow({ label, desc, onClick, disabled, badge }: {
  label: string;
  desc: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...actionButton({ disabled }), ...sx.rowBox }}
    >
      <span style={sx.labelSlot}>
        <span style={sx.plate}>{label}</span>
      </span>

      <span style={sx.desc}>{desc}</span>

      {badge
        ? <span style={sx.badge}>{badge}</span>
        : <span style={sx.chevron} aria-hidden>›</span>}
    </button>
  );
}

const sx: Record<string, React.CSSProperties> = {
  close: {
    position: "absolute", top: 12, right: 16, background: "none", border: "none",
    color: C.dim, fontSize: 30, cursor: "pointer", lineHeight: 1, padding: 4,
  },
  /**
   * Kept compact deliberately: this panel opens over the city, where the
   * viewport is already shorter than a full page, and the previous spacing
   * pushed the fourth mode below the fold and put a scrollbar on a four-item
   * menu.
   */
  hero: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: SP.sm, marginBottom: SP.lg,
  },
  tagline: {
    margin: 0, fontSize: T.small, color: C.body, textAlign: "center",
    lineHeight: 1.5, maxWidth: 420,
  },
  record: {
    display: "flex", gap: SP.sm, fontSize: T.small, fontFamily: MONO,
    fontWeight: 700, background: C.ink, border: `1px solid ${C.line}`,
    borderRadius: R.pill, padding: "6px 16px",
  },
  list: { display: "flex", flexDirection: "column", gap: SP.sm, marginTop: SP.sm },
  /** Layout, applied after `actionButton` so `disabled` can't drop the padding. */
  rowBox: {
    display: "flex", alignItems: "center", gap: SP.lg, textAlign: "left",
    padding: `${SP.md}px ${SP.lg}px`, color: C.text, width: "100%",
  },
  /** One fixed slot, so every mode's label is the same size and the descriptions line up. */
  labelSlot: { flexShrink: 0, width: "min(190px, 34%)", display: "flex", alignItems: "center" },
  /**
   * Every mode gets the SAME plate.
   *
   * These rows used Unity's `Interface guidance/Menus` label sprites, but that
   * set was never designed as one: the four we need are different widths,
   * heights, colours and slant angles, so a column of them reads as four
   * unrelated buttons no matter how they are scaled. One plate in the brand's
   * own gradient is the consistent treatment, and it is legible at any size —
   * which the pixel sprites were not once downscaled to fit a row.
   */
  plate: { ...labelPlate(), width: "100%", height: 38, justifyContent: "center", fontSize: T.small },
  desc: { flex: 1, minWidth: 0, fontSize: T.body, color: C.body, lineHeight: 1.55 },
  chevron: { color: C.faint, fontSize: T.title, flexShrink: 0, lineHeight: 1 },
  badge: {
    flexShrink: 0, fontSize: T.eyebrow, letterSpacing: 1.5, color: C.faint,
    border: `1px solid ${C.line}`, borderRadius: R.sm, padding: "5px 10px", fontWeight: 700,
  },
};
