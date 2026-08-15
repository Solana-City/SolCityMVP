/**
 * Sol Mechs — attack effect library.
 *
 * Ported from Unity's `Resources/AttackFxLibrary.asset`, which mapped each
 * move by NAME to a VFX prefab. Those prefab GUIDs were resolved back to the
 * sprite sequences under Sprites/BattleVFXs/effectsSprites, and the frame
 * rates come from the matching .anim files (`m_SampleRate`).
 *
 * The source frames are up to 2180x1760 — around 15 MB decoded each — so they
 * were boxed down to fit 160px on import. At the size a mech is drawn, the
 * originals carried no detail the smaller frames lose.
 *
 * Four moves post-date the Unity library (Solus Burst, Blade Rush, Boost Dash,
 * Nano Repair) and have no entry there. They fall through to a by-damage-type
 * default rather than being left silent, which is flagged at each site below.
 */
import type { DamageType, MoveDefinition } from "../data/types";

const BASE = "/assets/minigames/sol-mechs/vfx";

export interface FxClip {
  id: string;
  frames: number;
  /** Frames per second, from the Unity .anim sample rate. */
  fps: number;
  /** On-screen height in canvas px at scale 1; width follows the aspect. */
  size: number;
  /** Additive blending reads as light — right for energy, wrong for impacts. */
  additive?: boolean;
}

export const FX: Record<string, FxClip> = {
  kick:   { id: "kick",                frames: 8,  fps: 12, size: 74 },
  orb:    { id: "green_purple_sphere", frames: 23, fps: 16, size: 66, additive: true },
  energy: { id: "energy",              frames: 6,  fps: 12, size: 70, additive: true },
  flash:  { id: "flash",               frames: 6,  fps: 12, size: 62, additive: true },
  stomp:  { id: "stomp",               frames: 8,  fps: 12, size: 76 },
  boom:   { id: "boom",                frames: 5,  fps: 6,  size: 88 },
  up:     { id: "up",                  frames: 8,  fps: 12, size: 52, additive: true },
  down:   { id: "down",                frames: 8,  fps: 12, size: 52, additive: true },
};

/**
 * Move name → clip, exactly as the Unity library had it. Names are matched
 * case-insensitively because the .asset files and the FX library disagree on
 * capitalisation ("Titan punch" vs "Titan Punch", "Striker shot" vs
 * "Striker Shot") and matching on the raw string silently dropped effects.
 */
const BY_MOVE: Record<string, FxClip> = {
  "crush grip":      FX.kick,
  "titan punch":     FX.orb,
  "piercing shot":   FX.orb,
  "striker shot":    FX.flash,
  "arclight ray":    FX.flash,
  "pulse wave":      FX.flash,
  "overdrive spike": FX.stomp,
  "disable motors":  FX.stomp,
  "fortify":         FX.energy,
  "focus aim":       FX.energy,
  "energy boost":    FX.energy,
  "system reboot":   FX.energy,
};

/** Fallback for the four moves added after the Unity library was last saved. */
function defaultFor(move: MoveDefinition): FxClip {
  if (move.baseDamage <= 0) return FX.energy;
  const type: DamageType = move.damageType;
  return type === "Physical" ? FX.kick : FX.flash;
}

export function fxForMove(move: MoveDefinition): FxClip {
  return BY_MOVE[move.name.toLowerCase()] ?? defaultFor(move);
}

/** Stat-stage arrows — the Up/Down sequences, picked by direction. */
export function fxForStage(delta: number): FxClip {
  return delta > 0 ? FX.up : FX.down;
}

/** Played where a limb is destroyed. */
export const FX_DESTROY = FX.boom;

const cache = new Map<string, HTMLImageElement>();

export function fxFrame(clip: FxClip, frame: number): HTMLImageElement {
  const key = `${clip.id}/${frame}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = new Image();
  img.src = `${BASE}/${clip.id}/${frame}.png`;
  cache.set(key, img);
  return img;
}

/** Warm every clip. 72 frames at ~350 KB total — cheap enough to do up front. */
export function preloadFx(): void {
  for (const clip of Object.values(FX)) {
    for (let i = 1; i <= clip.frames; i++) fxFrame(clip, i);
  }
}

/** Total run time of a clip, in ms — used to schedule what follows it. */
export function clipDuration(clip: FxClip): number {
  return (clip.frames / clip.fps) * 1000;
}
