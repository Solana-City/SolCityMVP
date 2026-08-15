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
 * Every chassis is available.
 *
 * `owned` exists for the unlock/progression flow that will gate chassis
 * later, but no such flow is built yet — and while it defaulted to Titan
 * alone, the hangar (which lists all five) and the Workshop (which listed
 * only owned ones) disagreed about what you could fly. Defaulting to the
 * full roster keeps the two screens telling the same story until unlocking
 * is real.
 */
export const DEFAULT_HANGAR: HangarState = {
  owned: [...MECH_IDS],
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

    // Ownership is not gated yet, so the saved list is deliberately ignored
    // in favour of the full roster — otherwise a save written before every
    // chassis was unlocked would keep that player restricted to Titan with no
    // way out. Restore `parsed.owned` here once unlocking is real.
    const owned = [...MECH_IDS];

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
  // Hot-swap hook for the overworld companion. Nothing listens today — the
  // escort is unwired (see MechCompanion) — but the event is kept so
  // re-enabling it needs no change here.
  try {
    (globalThis as any).__solCityGameEvents?.emit("solmechs:activeChanged", next.active);
  } catch {}
  return next;
}

/**
 * Persist a customized build for one mech.
 *
 * Stored per mech rather than as a single active build, so switching chassis
 * in the Workshop doesn't discard the loadout you tuned for the other one.
 */
export function setBuild(mech: MechId, build: MechBuild): HangarState {
  const state = loadHangar();
  const next: HangarState = {
    ...state,
    builds: { ...state.builds, [mech]: build },
  };
  saveHangar(next);
  return next;
}

/** Drop a mech's customization, reverting it to the stock preset. */
export function resetBuild(mech: MechId): HangarState {
  const state = loadHangar();
  const builds = { ...state.builds };
  delete builds[mech];
  const next: HangarState = { ...state, builds };
  saveHangar(next);
  return next;
}

export function unlockMech(mech: MechId): HangarState {
  const state = loadHangar();
  if (state.owned.includes(mech)) return state;
  const next: HangarState = { ...state, owned: [...state.owned, mech] };
  saveHangar(next);
  return next;
}
