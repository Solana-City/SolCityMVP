/**
 * Sol Mechs — player hangar state.
 *
 * What the player owns and what they currently have deployed. Persisted to
 * localStorage for now, mirroring how paperDoll.ts stores the avatar loadout,
 * so the companion and the hangar screen survive a reload before any of this
 * lives on-chain.
 *
 * The shape is deliberately the same one a PDA would hold — an owned set plus
 * an active build per mech — so moving this to an account later is a swap of
 * the read/write pair below, not a redesign.
 */
import type { MechBuild, MechId } from "./data/types";
import { PRESET_BUILDS } from "./data/catalog";
import { MECH_IDS } from "./data/types";

const STORAGE_KEY = "solcity:solmechs";

export interface HangarState {
  /** Mechs the player has unlocked. */
  owned: MechId[];
  /** Which one escorts them in the overworld, or null for none. */
  active: MechId | null;
  /** Per-mech loadout; falls back to the preset when absent. */
  builds: Partial<Record<MechId, MechBuild>>;
  /** Lifetime battle record, for the hangar screen. */
  wins: number;
  losses: number;
}

/**
 * Everyone starts with Titan. It's the tank — the most forgiving chassis to
 * learn the limb/matrix rule on, since it survives long enough to make the
 * mistake twice.
 */
export const DEFAULT_HANGAR: HangarState = {
  owned: ["titan"],
  active: "titan",
  builds: {},
  wins: 0,
  losses: 0,
};

function isMechId(v: unknown): v is MechId {
  return typeof v === "string" && (MECH_IDS as string[]).includes(v);
}

export function loadHangar(): HangarState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HANGAR };
    const parsed = JSON.parse(raw) as Partial<HangarState>;

    // Sanitize rather than trust: a stale save from an earlier catalog could
    // otherwise hand a mech id that no longer exists to the sprite loader.
    const owned = Array.isArray(parsed.owned) ? parsed.owned.filter(isMechId) : [];
    if (owned.length === 0) owned.push("titan");

    const active = isMechId(parsed.active) && owned.includes(parsed.active) ? parsed.active : owned[0];

    return {
      owned,
      active,
      builds: parsed.builds ?? {},
      wins: typeof parsed.wins === "number" ? parsed.wins : 0,
      losses: typeof parsed.losses === "number" ? parsed.losses : 0,
    };
  } catch {
    return { ...DEFAULT_HANGAR };
  }
}

export function saveHangar(state: HangarState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

/** The build for a mech — the player's customization, or the stock preset. */
export function getBuild(state: HangarState, mech: MechId): MechBuild {
  return state.builds[mech] ?? PRESET_BUILDS[mech];
}

export function recordResult(won: boolean): HangarState {
  const state = loadHangar();
  const next: HangarState = {
    ...state,
    wins: state.wins + (won ? 1 : 0),
    losses: state.losses + (won ? 0 : 1),
  };
  saveHangar(next);
  return next;
}

export function setActiveMech(mech: MechId | null): HangarState {
  const state = loadHangar();
  const next: HangarState = {
    ...state,
    active: mech && state.owned.includes(mech) ? mech : null,
  };
  saveHangar(next);
  // The city scene listens for this so the companion swaps without a reload.
  try {
    (globalThis as any).__solCityGameEvents?.emit("solmechs:activeChanged", next.active);
  } catch {}
  return next;
}

export function unlockMech(mech: MechId): HangarState {
  const state = loadHangar();
  if (state.owned.includes(mech)) return state;
  const next: HangarState = { ...state, owned: [...state.owned, mech] };
  saveHangar(next);
  return next;
}
