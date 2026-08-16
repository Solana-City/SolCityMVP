"use client";

/**
 * Sol Mechs — main menu.
 *
 * The entry point used to be the mech roster: the player was dropped into a
 * grid of five mechs with no idea what pressing one would do. Choosing a MODE
 * is the first real decision, so it comes first, and each row says what it is
 * before you commit.
 *
 * Mode labels use Unity's own menu art (Interface guidance/Menus) wherever the
 * baked-in wording is accurate. Squad 3v3 has no matching label in that set,
 * so it renders on the same gradient plate in CSS — normalised to
 * LABEL_HEIGHT, because the sprites have different baked widths and matching
 * on height is what makes a row of them read as one set.
 */
import { useEffect } from "react";
import { C, T, SP, R, MONO, PIXELATED, backdrop, panel, eyebrow, labelPlate, LABEL_HEIGHT } from "./theme";

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
      <div style={{ ...panel("min(600px, 100%)"), padding: `${SP.xxl}px ${SP.xl}px ${SP.xl}px`, overflowY: "auto", overflowX: "hidden" }}>
        <button onClick={onClose} style={sx.close} aria-label="Close">×</button>

        <header style={sx.hero}>
          <img
            src={`${UI}/logo.png`}
            alt="Sol Mechs"
            style={{ ...PIXELATED, width: "min(330px, 82%)", height: "auto", display: "block" }}
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
            art={`${UI}/menu/pve.png`}
            fallback="ARENA PvE"
            desc="Duel one rival mech. Best place to learn the rules."
            onClick={() => onChoose("pve")}
          />
          <MenuRow
            label="SQUAD 3v3"
            desc="Three mechs, one at a time. Substituting is your whole round."
            onClick={() => onChoose("squad")}
          />
          <MenuRow
            art={`${UI}/menu/editor.png`}
            fallback="SOL MECH EDITOR"
            desc="Swap parts across chassis and save a loadout."
            onClick={() => onChoose("workshop")}
          />
          <MenuRow
            art={`${UI}/menu/pvp.png`}
            fallback="ARENA PvP"
            desc="Season ladder. One pass, an exclusive mech, USDC by placement."
            badge="SOON"
            disabled
          />
        </div>
      </div>
    </div>
  );
}

function MenuRow({ art, fallback, label, desc, onClick, disabled, badge }: {
  art?: string;
  fallback?: string;
  label?: string;
  desc: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...sx.row, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <span style={sx.labelSlot}>
        {art ? (
          <img
            src={art}
            alt={fallback ?? ""}
            // Height-matched, width free — see LABEL_HEIGHT.
            style={{ ...PIXELATED, height: LABEL_HEIGHT, width: "auto", display: "block" }}
            onError={(e) => {
              // Swap in the text plate so a missing sprite never leaves an
              // unlabelled button.
              const el = e.currentTarget;
              const span = document.createElement("span");
              span.textContent = fallback ?? "";
              Object.assign(span.style, {
                display: "inline-flex", alignItems: "center", height: `${LABEL_HEIGHT}px`,
                padding: "0 16px", color: "#fff", fontSize: `${T.small}px`, fontWeight: "800",
                letterSpacing: "1.5px", whiteSpace: "nowrap",
                background: `linear-gradient(180deg, ${C.cyan}, ${C.purple})`,
              });
              el.replaceWith(span);
            }}
          />
        ) : (
          <span style={labelPlate()}>{label}</span>
        )}
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
  hero: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: SP.md, marginBottom: SP.xxl,
  },
  tagline: {
    margin: 0, fontSize: T.body, color: C.body, textAlign: "center",
    lineHeight: 1.6, maxWidth: 420,
  },
  record: {
    display: "flex", gap: SP.sm, fontSize: T.small, fontFamily: MONO,
    fontWeight: 700, background: C.ink, border: `1px solid ${C.line}`,
    borderRadius: R.pill, padding: "6px 16px",
  },
  list: { display: "flex", flexDirection: "column", gap: SP.sm, marginTop: SP.sm },
  row: {
    display: "flex", alignItems: "center", gap: SP.lg, textAlign: "left",
    background: C.ink, border: `1px solid ${C.line}`, borderRadius: R.md,
    padding: `${SP.md}px ${SP.lg}px`, color: C.text, fontFamily: "inherit", width: "100%",
  },
  /** Fixed slot so the descriptions align down the column. */
  labelSlot: { flexShrink: 0, width: 172, display: "flex", alignItems: "center" },
  desc: { flex: 1, minWidth: 0, fontSize: T.body, color: C.body, lineHeight: 1.55 },
  chevron: { color: C.faint, fontSize: T.title, flexShrink: 0, lineHeight: 1 },
  badge: {
    flexShrink: 0, fontSize: T.eyebrow, letterSpacing: 1.5, color: C.faint,
    border: `1px solid ${C.line}`, borderRadius: R.sm, padding: "5px 10px", fontWeight: 700,
  },
};
