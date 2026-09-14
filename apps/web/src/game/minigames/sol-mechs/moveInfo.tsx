"use client";

/**
 * Sol Mechs — what a move is, as pictures.
 *
 * Every move falls in one category (Attack / Buff / Heal), carries a damage
 * type and maybe a stat rider. Each of those has a sprite from the game's own
 * VFX set, so the action buttons and the move info strip can say it with an
 * icon and a number instead of a sentence.
 */
import type { MoveDefinition, StageableStat } from "@/game/solmechs/data/types";
import { C, MONO, PIXELATED } from "./theme";

const VFX = "/assets/minigames/sol-mechs/vfx";
const UI = "/assets/minigames/sol-mechs/ui";

export type MoveCategory = "attack" | "buff" | "heal";

export const MOVE_CATEGORY: Record<MoveCategory, { label: string; color: string; icon: string }> = {
  attack: { label: "ATTACK", color: "#ff7a59", icon: `${VFX}/kick/4.png` },
  buff:   { label: "BUFF",   color: C.teal,    icon: `${VFX}/up/4.png` },
  heal:   { label: "HEAL",   color: "#7ee081", icon: `${VFX}/green_purple_sphere/5.png` },
};

export function moveCategory(m: MoveDefinition): MoveCategory {
  if (m.healAmount && m.healAmount > 0) return "heal";
  if (m.targetType === "self") return "buff";
  return "attack";
}

/** The damage-type picture: an impact for Physical, a beam for Energy. */
export function damageTypeIcon(m: MoveDefinition): string {
  return m.damageType === "Energy" ? `${VFX}/energy/3.png` : `${VFX}/kick/4.png`;
}

export function statIcon(stat: StageableStat, up: boolean): string {
  return `${VFX}/stat/${stat}_${up ? "Up" : "Down"}.png`;
}

export const SLOT_ICON = {
  matrix: `${UI}/slotmini-matrix.png`,
  rightArm: `${UI}/slotmini-rightarm.png`,
  leftArm: `${UI}/slotmini-leftarm.png`,
  lowerBody: `${UI}/slotmini-legs.png`,
} as const;

export function Sprite({ src, h, dim, style }: { src: string; h: number; dim?: boolean; style?: React.CSSProperties }) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        ...PIXELATED, height: h, width: "auto", display: "block", flexShrink: 0,
        opacity: dim ? 0.45 : 1, filter: dim ? "grayscale(1)" : undefined, ...style,
      }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
    />
  );
}

/** Category icon inside a small tinted tile, sized for a one-line button. */
export function CategoryTile({ m, size = 24 }: { m: MoveDefinition; size?: number }) {
  const cat = MOVE_CATEGORY[moveCategory(m)];
  return (
    <span
      title={cat.label}
      style={{
        width: size, height: size, flexShrink: 0, borderRadius: 5,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: `${cat.color}22`, boxShadow: `inset 0 0 0 1px ${cat.color}88`,
      }}
    >
      <Sprite src={cat.icon} h={size - 6} />
    </span>
  );
}

/**
 * The right-hand badge of a move button: damage for an attack, the stat
 * icon for a buff. Fixed width so every button lines up.
 */
export function MoveBadge({ m }: { m: MoveDefinition }) {
  const mod = m.statModifiers[0];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: "auto", flexShrink: 0 }}>
      {m.baseDamage > 0 && (
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 800, color: C.text }}>{m.baseDamage}</span>
      )}
      {m.baseDamage > 0 && <Sprite src={damageTypeIcon(m)} h={16} />}
      {mod && <Sprite src={statIcon(mod.stat, mod.amount > 0)} h={16} />}
    </span>
  );
}
