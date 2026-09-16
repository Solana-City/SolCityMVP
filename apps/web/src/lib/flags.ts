/**
 * Runtime content toggles, set from the developer panel.
 *
 * A flag is something the team needs to change without a deploy: taking a
 * mini-game down while it is broken, silencing chat, hiding a screen that
 * depends on a program that is not upgraded yet. Anything that is really a
 * build-time constant (balance numbers, sprite paths) does NOT belong here.
 *
 * Flags live in the same store as the nicknames, so they need the same Upstash
 * configuration; without it, reads return the defaults and writes are refused.
 */
import { hdel, hgetall, hset, storeMode } from "./kv";

const KEY = "flags";

export interface FlagDef {
  id: string;
  label: string;
  /** What is different when the flag is ON. */
  effect: string;
  default: boolean;
}

/**
 * The known flags. The panel renders this list, so adding one here is all it
 * takes for it to be togglable; the game reads them through /api/flags.
 */
export const FLAGS: FlagDef[] = [
  {
    id: "pvp",
    label: "Sol Mechs PvP",
    effect: "Players can search for online matches.",
    default: true,
  },
  {
    id: "duels",
    label: "City duel invites",
    effect: "The MECH BATTLE button on a player card.",
    default: true,
  },
  {
    id: "ranked",
    label: "Ranked season",
    effect: "The RANKED row in the Sol Mechs menu.",
    default: false,
  },
  {
    id: "nicknames",
    label: "Nickname claiming",
    effect: "Players can claim or change a nickname.",
    default: true,
  },
  {
    id: "chat",
    label: "City chat",
    effect: "Local and global chat in the city.",
    default: true,
  },
];

export type Flags = Record<string, boolean>;

function defaults(): Flags {
  return Object.fromEntries(FLAGS.map((f) => [f.id, f.default]));
}

/** Current values, defaults filled in for anything never set. */
export async function readFlags(): Promise<Flags> {
  const out = defaults();
  if (storeMode() === "off") return out;
  try {
    const stored = await hgetall(KEY);
    for (const [id, value] of Object.entries(stored)) out[id] = value === "1";
  } catch {
    /* store hiccup: the defaults are the safe answer */
  }
  return out;
}

/** Sets one flag, or clears it back to its default when `value` is null. */
export async function writeFlag(id: string, value: boolean | null): Promise<Flags> {
  if (!FLAGS.some((f) => f.id === id)) throw new Error(`unknown flag: ${id}`);
  if (storeMode() === "off") throw new Error("the flag store is not configured");
  if (value === null) await hdel(KEY, id);
  else await hset(KEY, id, value ? "1" : "0");
  return readFlags();
}
