"use client";

import { useState } from "react";

import { chamferBox } from "@/ui/chamfer";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";

/**
 * Pixel-art icons for HUD panels, from sprites already in the build.
 *
 * The panels used emoji (🏆 📋 🔒 🔊 🥇 ...), which render as each OS's own
 * glossy art next to the city's pixel art. Everything here is a game sprite,
 * or, where the build has no sprite for an idea (a lock, a speaker), a tiny
 * icon drawn on a pixel grid so it matches.
 */

const UI = "/assets/ui";
/** One walk-grid frame; every character sheet is 4x4 of these. */
const FRAME_PX = 64;

export const ICON = {
  trophy: `${UI}/icon2_trophy.png`,
  tasks: `${UI}/ico_tasks.png`,
  hunt: `${UI}/icon_quests2.png`,
  wardrobe: `${UI}/icon_wardrob1.png`,
  chat: `${UI}/ico_chat.png`,
  emote: `${UI}/ico_emoji.png`,
  star: `${UI}/attention_yellow.png`,
  close: `${UI}/icon_close.png`,
} as const;

/** The UI's default accent, for anything not inside an NPC's own colored window. */
export const UI_ACCENT = "#14ebc1";

/**
 * A white/gray-on-transparent icon, tinted via a CSS luminance mask: white
 * paints fully opaque, gray shading paints partially, transparent stays
 * empty — same shape, any color, no per-color art files.
 */
export function maskIcon(icon: string, color: string, size: number): React.CSSProperties {
  return {
    display: "block", width: size, height: size, background: color,
    WebkitMaskImage: `url(${icon})`, maskImage: `url(${icon})`,
    WebkitMaskMode: "luminance", maskMode: "luminance",
    WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
  } as React.CSSProperties;
}

/**
 * The one close ("×") button, everywhere a panel or dialog can be dismissed.
 * Pass `color` inside an NPC dialog to match its category; everywhere else
 * it defaults to the UI's own accent color.
 */
export function CloseButton({
  onClick, size = 22, label = "Close", color = UI_ACCENT, style,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  size?: number;
  label?: string;
  color?: string;
  style?: React.CSSProperties;
}) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick}
      aria-label={label}
      {...feel.handlers}
      style={{
        background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 0, flexShrink: 0, display: "block",
        ...feelStyle(feel, { pressScale: 0.85 }),
        ...style,
      }}
    >
      <span aria-hidden style={maskIcon(ICON.close, color, size)} />
    </button>
  );
}

/**
 * A protocol NPC's own sprite, frame 0, as a small square "logo" next to a
 * panel's title — the same sheet the NPC walks around in, not a separate
 * icon file. Most character sheets are a 256x256 grid of 64px frames
 * (default); the ST Brasil stand NPCs (Raffx, Crash, Cloak) are a single
 * 384x64 row of 6 — pass their real sheetWidth/sheetHeight so the crop
 * lands on frame 0 instead of stretching across the wrong grid.
 */
export function ProtocolLogo({
  sheet, size = 24, sheetWidth = 256, sheetHeight = 256,
}: {
  sheet: string;
  size?: number;
  sheetWidth?: number;
  sheetHeight?: number;
}) {
  const cols = sheetWidth / FRAME_PX;
  const rows = sheetHeight / FRAME_PX;
  return (
    <span
      aria-hidden
      style={{
        display: "block", width: size, height: size, flexShrink: 0, overflow: "hidden",
        backgroundImage: `url("/assets/sprites/${sheet}")`,
        backgroundSize: `${size * cols}px ${size * rows}px`,
        backgroundPosition: "0 0",
        imageRendering: "pixelated",
      }}
    />
  );
}

/**
 * Header row for a protocol's application window: logo + title on the left,
 * the close button on the right — same layout as the Wardrobe/Leaderboard
 * panel titles, so every "app" an NPC opens reads as part of one system.
 */
export function PanelTitleBar({
  title, onClose, color = UI_ACCENT, logo, extra, style,
}: {
  title: string;
  onClose: () => void;
  color?: string;
  logo?: React.ReactNode;
  /** Extra content between the title and the close button, e.g. a status chip. */
  extra?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {logo}
        <span style={{
          fontFamily: '"Press Start 2P", monospace', fontSize: 12, color, letterSpacing: 2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {title}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {extra}
        <CloseButton onClick={onClose} color={color} />
      </div>
    </div>
  );
}

/** A box breaking out of its top-right corner with an arrow — opens elsewhere. */
export function ExternalLinkIcon({ size = 10, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" shapeRendering="crispEdges"
      style={{ display: "block", flexShrink: 0 }}>
      <path d="M6.5 3H3.5a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1H12a1 1 0 0 0 1-1V9.5"
        stroke={color} strokeWidth="1.4" />
      <path d="M9 2.5h4.5V7M13.3 2.7 7.5 8.5" stroke={color} strokeWidth="1.4" strokeLinecap="square" />
    </svg>
  );
}

/**
 * The pill that sends a player off to a protocol's own site: the UI accent
 * color, a light chamfer, a hover glow, and the external-link glyph so it
 * never reads as "close" or an in-app action.
 */
export function SiteLinkButton({
  href, label, color = UI_ACCENT, style,
}: {
  href: string;
  label: string;
  color?: string;
  style?: React.CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={chamferBox(6, {
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
        padding: "10px 16px", fontFamily: '"Press Start 2P", monospace', fontSize: 7,
        color, background: hover ? `${color}26` : `${color}14`,
        border: `1px solid ${color}${hover ? "aa" : "66"}`,
        textDecoration: "none", cursor: "pointer", whiteSpace: "nowrap",
        transition: "background 0.15s, border-color 0.15s",
        ...style,
      })}
    >
      {label}
      <ExternalLinkIcon size={9} color={color} />
    </a>
  );
}

export function PixelImg({ src, size, style, alt = "" }: { src: string; size: number; style?: React.CSSProperties; alt?: string }) {
  // The size the layout asked for, always. An earlier version snapped it to
  // the pixel grid once the file loaded, which grew icons by a few pixels on
  // a 125% screen and pushed the zoom control's + button out of its row. A
  // layout must never depend on the screen's ratio; whether the art is drawn
  // crisp or smooth is useCrispPixelArt's job, and that one changes no sizes.
  return (
    <img
      src={src} alt={alt} draggable={false}
      style={{ height: size, width: "auto", display: "inline-block", verticalAlign: "middle", imageRendering: "pixelated", flexShrink: 0, ...style }}
    />
  );
}

/** A 256x256 character sheet's standing frame (frame 0), cropped to a square. */
export function CitizenIcon({ sheet, size }: { sheet: string; size: number }) {
  // The art inside is a 64px frame drawn at 1.1x the box; snap THAT to whole
  // device pixels and derive the rest from it, so the crop stays put.
  // At LEAST 1.1x the box: a smaller frame would let the row below it (the
  // character's back) show under the chin.
  // Plain arithmetic: the crop stays put whatever the screen's ratio is.
  const frame = size * 1.1;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block", width: size, height: size, flexShrink: 0,
        backgroundImage: `url("/assets/sprites/${sheet}")`,
        backgroundSize: `${frame * 4}px ${frame * 4}px`,
        backgroundPosition: `${-frame * 0.18}px ${-frame * 0.055}px`,
        imageRendering: "pixelated",
      }}
    />
  );
}

/** Draw a bitmap of rows ("#" = filled) as crisp squares. */
function Bitmap({ rows, size, color }: { rows: string[]; size: number; color: string }) {
  const h = rows.length;
  const w = rows[0].length;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null)))}
    </svg>
  );
}

export function LockIcon({ size = 16, color = "#cbd5e1" }: { size?: number; color?: string }) {
  return (
    <Bitmap size={size} color={color} rows={[
      "...####...",
      "..#....#..",
      "..#....#..",
      "..#....#..",
      ".########.",
      ".########.",
      ".####.###.",
      ".####.###.",
      ".########.",
      ".########.",
    ]} />
  );
}

export function SpeakerIcon({ size = 16, muted, color = "#cbd5e1" }: { size?: number; muted: boolean; color?: string }) {
  return (
    <Bitmap size={size} color={color} rows={muted ? [
      "..........",
      "...#......",
      "..##..#..#",
      "####...##.",
      "####...##.",
      "####..#..#",
      "..##......",
      "...#......",
      "..........",
      "..........",
    ] : [
      "..........",
      "...#...#..",
      "..##.#..#.",
      "####..#.#.",
      "####..#.#.",
      "####..#.#.",
      "..##.#..#.",
      "...#...#..",
      "..........",
      "..........",
    ]} />
  );
}

/** Podium rank: gold/silver/bronze pixel medal with the number, plain number after 3. */
export function RankBadge({ rank, size = 18 }: { rank: number; size?: number }) {
  const colors = ["#FFD700", "#C0C7D1", "#CD7F32"];
  if (rank > 3) {
    return <span style={{ display: "inline-block", minWidth: size, textAlign: "center", color: "#8888aa" }}>{rank}</span>;
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size,
      background: colors[rank - 1], color: "#1a1405", fontSize: Math.round(size * 0.45),
      clipPath: "polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%)",
      fontFamily: '"Press Start 2P", monospace', flexShrink: 0,
    }}>
      {rank}
    </span>
  );
}

/** Quest/checklist state as a pixel box: empty, done (gold), claimed (green check). */
export function CheckBox({ state, size = 14 }: { state: "todo" | "done" | "claimed"; size?: number }) {
  const border = state === "claimed" ? "#B7E928" : state === "done" ? "#FFD700" : "#555577";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, flexShrink: 0,
      border: `2px solid ${border}`, background: state === "todo" ? "transparent" : `${border}33`,
    }}>
      {state === "claimed" && (
        <Bitmap size={size - 4} color="#B7E928" rows={[
          "......#",
          ".....##",
          "#...##.",
          "##.##..",
          ".###...",
          "..#....",
          ".......",
        ]} />
      )}
      {state === "done" && <span style={{ width: size - 8, height: size - 8, background: "#FFD700" }} />}
    </span>
  );
}

/** Achievement id -> the citizen it is about (or the trophy for the summit). */
export const ACHIEVEMENT_ART: Record<string, { sheet?: string; img?: string }> = {
  "first-swap": { sheet: "Jupiter Joe.png" },
  "first-transfer": { sheet: "send-npc.png" },
  "streak-3": { img: `${UI}/attention_yellow.png` },
  "met-sol": { sheet: "Sol.png" },
  "met-everyone": { img: `${UI}/ico_chat.png` },
  "trader-10": { sheet: "Jupiter Joe.png" },
  "streak-7": { img: `${UI}/attention_yellow.png` },
  "score-1000": { img: ICON.trophy },
};

export function AchievementIcon({ id, size = 28 }: { id: string; size?: number }) {
  const art = ACHIEVEMENT_ART[id];
  if (art?.sheet) return <CitizenIcon sheet={art.sheet} size={size} />;
  return <PixelImg src={art?.img ?? ICON.trophy} size={size} />;
}

/** The calendar sprite with a date written on its white page. */
export function CalendarDayIcon({ size, day }: { size: number; day: number | string }) {
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, flexShrink: 0 }}>
      <img src={`${UI}/icon_calendar.png`} alt="" draggable={false}
        style={{ width: "100%", height: "100%", imageRendering: "pixelated", display: "block" }} />
      <span style={{
        position: "absolute", left: 0, right: 0, top: "40%", height: "44%",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: '"Press Start 2P", monospace', fontSize: Math.max(6, Math.round(size * 0.24)),
        color: "#0a1a2e", lineHeight: 1, pointerEvents: "none",
      }}>{day}</span>
    </span>
  );
}
