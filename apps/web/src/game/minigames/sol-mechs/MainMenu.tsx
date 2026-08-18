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
import { C, T, SP, R, MONO, PIXELATED, backdrop, panel, eyebrow, labelPlate, actionButton, LABEL_HEIGHT, W } from "./theme";

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
      <div style={{ ...panel(W.narrow), padding: `${SP.xxl}px ${SP.xl}px ${SP.xl}px`, overflowY: "auto", overflowX: "hidden" }}>
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
      style={{ ...sx.row, ...actionButton({ disabled }), ...sx.rowBox }}
    >
      <span style={sx.labelSlot}>
        {art ? (
          <img
            src={art}
            alt={fallback ?? ""}
            // WIDTH-matched at the sprites' native 260px, not height-matched.
            // These are pixel art with baked-in lettering: squeezed to a 30px
            // row height they came out ~99px wide, a 2.6x downscale that turned
            // the words into mush. All seven are 260 wide, so matching on width
            // shows them 1:1 AND keeps the column aligned; the 68-88px spread in
            // their heights is absorbed by centring the row.
            style={{ ...PIXELATED, width: "100%", height: "auto", display: "block" }}
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
          // Stretched to the same slot as the sprites and centred, so the one
          // mode with no Unity label of its own still reads as part of the set.
          <span style={{ ...labelPlate(), width: "100%", height: 58, justifyContent: "center", fontSize: T.body }}>{label}</span>
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
  /**
   * The Unity menu button, not a CSS rectangle.
   *
   * `1_Main_Menu.unity` builds every mode button from `UI/button3.png`, so a
   * rounded div with a 1px border was the one thing on this screen that wasn't
   * the game's own art. `actionButton` is the same 9-slice the arena's controls
   * use, which is also what the original does — the scene reuses that sprite
   * for the menu and the battle alike.
   */
  row: { ...actionButton() },
  /** Layout, applied after the tone so `disabled` can't drop the padding. */
  rowBox: {
    display: "flex", alignItems: "center", gap: SP.lg, textAlign: "left",
    padding: `${SP.md}px ${SP.lg}px`, color: C.text, width: "100%",
  },
  /** The sprites' own 260px, so they render 1:1 and the column stays aligned. */
  labelSlot: { flexShrink: 0, width: "min(260px, 38%)", display: "flex", alignItems: "center" },
  desc: { flex: 1, minWidth: 0, fontSize: T.body, color: C.body, lineHeight: 1.55 },
  chevron: { color: C.faint, fontSize: T.title, flexShrink: 0, lineHeight: 1 },
  badge: {
    flexShrink: 0, fontSize: T.eyebrow, letterSpacing: 1.5, color: C.faint,
    border: `1px solid ${C.line}`, borderRadius: R.sm, padding: "5px 10px", fontWeight: 700,
  },
};
