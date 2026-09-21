"use client";

/**
 * Pixel-art icons for HUD panels, from sprites already in the build.
 *
 * The panels used emoji (🏆 📋 🔒 🔊 🥇 ...), which render as each OS's own
 * glossy art next to the city's pixel art. Everything here is a game sprite,
 * or, where the build has no sprite for an idea (a lock, a speaker), a tiny
 * icon drawn on a pixel grid so it matches.
 */

const UI = "/assets/ui";

export const ICON = {
  trophy: "/assets/minigames/sol-mechs/ui/win-trophy.png",
  tasks: `${UI}/ico_tasks.png`,
  hunt: `${UI}/ico_achievements.png`,
  wardrobe: `${UI}/ico_wardrop.png`,
  chat: `${UI}/ico_chat.png`,
  emote: `${UI}/ico_emoji.png`,
  star: `${UI}/attention_yellow.png`,
} as const;

export function PixelImg({ src, size, style, alt = "" }: { src: string; size: number; style?: React.CSSProperties; alt?: string }) {
  return (
    <img
      src={src} alt={alt} draggable={false}
      style={{ height: size, width: "auto", display: "inline-block", verticalAlign: "middle", imageRendering: "pixelated", flexShrink: 0, ...style }}
    />
  );
}

/** A 256x256 character sheet's standing frame (frame 0), cropped to a square. */
export function CitizenIcon({ sheet, size }: { sheet: string; size: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block", width: size, height: size, flexShrink: 0,
        backgroundImage: `url("/assets/sprites/${sheet}")`,
        backgroundSize: `${size * 4.4}px ${size * 4.4}px`,
        backgroundPosition: `${-size * 0.2}px ${-size * 0.06}px`,
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
  const border = state === "claimed" ? "#14F195" : state === "done" ? "#FFD700" : "#555577";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, flexShrink: 0,
      border: `2px solid ${border}`, background: state === "todo" ? "transparent" : `${border}33`,
    }}>
      {state === "claimed" && (
        <Bitmap size={size - 4} color="#14F195" rows={[
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
