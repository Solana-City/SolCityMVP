import type { PlayerProfile } from "@/game/config/profileManager";
import type { LayerCategory } from "@/game/config/paperDoll";
import { FOUND_COUNTER, PUMPKINS_PER_HUNT } from "@/game/halloween/pumpkinHunt";

/**
 * The quests the city actually has, as data.
 *
 * Until now these existed only as conditions inside `outfitRewards.ts`: no
 * name, no id, no step list, and no way for a player to see how far along they
 * were. Guarana's chain is seven NPCs long and the only feedback was the
 * unlock toast at the end.
 *
 * ── This file DESCRIBES. It does not GRANT. ───────────────────────────────
 *
 * `outfitRewards.ts` keeps every grant exactly as it was. Two places deciding
 * who earned what would drift, and the one that pays out is the one that must
 * stay authoritative. A step here reads the same player state the grant reads
 * and answers a narrower question: is this part done yet.
 *
 * So a quest can be wrong here and still pay out correctly there. The tests
 * pin the pairing, and the rule when they disagree is that outfitRewards wins
 * and this file is the bug.
 *
 * ── Ids are append-only ───────────────────────────────────────────────────
 *
 * A quest id and a step id are storage keys the moment anything remembers
 * progress across sessions, and the daily quests next door already learned
 * that the hard way: `send_steve` was renamed and reset everyone mid-quest.
 * Add, never rename.
 */

/** What a step can read. Deliberately not the storage it comes from. */
export interface QuestContext {
  profile: PlayerProfile;
  /**
   * Whether the wallet may wear an item: the same question the wardrobe asks.
   *
   * Several conditions are not visible in the profile at all. Nothing records
   * "won a round of Kite Clash" or "held SKR when you talked to the Seeker
   * Lover"; what is observable is the reward that followed. Those steps ask
   * this rather than inventing a counter, which would be a second source of
   * truth for something already decided elsewhere.
   */
  owns: (category: LayerCategory, id: string) => boolean;
}

export interface QuestStep {
  /** Append-only. */
  id: string;
  /** One line, player facing. No paragraphs. */
  label: string;
  done: (ctx: QuestContext) => boolean;
}

export interface QuestReward {
  category: LayerCategory;
  id: string;
  name: string;
}

export interface QuestDef {
  /** Append-only. */
  id: string;
  title: string;
  /** One line under the title. */
  blurb: string;
  /** NPC who tells the player about it, when one does. */
  giver?: string;
  steps: QuestStep[];
  reward: QuestReward;
}

// ── Step builders ───────────────────────────────────────────────────────────
//
// Small and named, so a quest reads as its own description rather than as a
// wall of closures.

const talkTo = (npcId: string, label: string): QuestStep => ({
  id: `talk:${npcId}`,
  label,
  done: ({ profile }) => profile.visitedNPCs.includes(npcId),
});

const earns = (
  id: string,
  label: string,
  category: LayerCategory,
  itemId: string,
): QuestStep => ({
  id,
  label,
  done: ({ owns }) => owns(category, itemId),
});

/**
 * A tally on the profile reaching its mark. The counter is bumped by whatever
 * owns the activity (the pumpkin hunt bumps its own), so this stays a reader
 * like every other step here.
 */
const collects = (counter: string, target: number, label: string): QuestStep => ({
  id: `count:${counter}:${target}`,
  label,
  done: ({ profile }) => (profile.counters?.[counter] ?? 0) >= target,
});

const streakOf = (days: number): QuestStep => ({
  id: `streak:${days}`,
  label: `Check in ${days} days in a row`,
  done: ({ profile }) => (profile.streakBest ?? 0) >= days,
});

/**
 * The ST Brasil crew, in the order `STBR_CREW` lists them in
 * `outfitRewards.ts`. Guarana is NOT one of them: he stands on the boardwalk
 * and points at the stands, which makes him the signpost rather than a step.
 *
 * `outfitRewards` filters this against the NPC registry so a disabled NPC
 * cannot make the shirt unreachable. This file does not, on purpose: a step
 * for an NPC who is not in the city should read as not done, not silently
 * vanish from the list and leave the player wondering why the count moved.
 */
const STBR_CREW: [string, string][] = [
  ["kuka", "Meet Kuka"],
  ["kite-pro", "Meet Kite Pro"],
  ["caramel-dog", "Find the Caramel Dog"],
  ["pegana-raffx", "Meet Raffx at the Pegana stand"],
  ["solsentry-crash", "Meet Crash at the SolSentry stand"],
  ["dungeons-moles", "Meet Moles at the Dungeons stand"],
  ["cloak-vitin", "Meet Vitin at the Cloak stand"],
];

// ── The quests ──────────────────────────────────────────────────────────────

export const QUESTS: QuestDef[] = [
  {
    // Halloween, in two halves: the city, then the knife. The middle step is
    // the one that makes the carve cost something, which is the whole point
    // of the hunt existing at all.
    id: "halloween-pumpkin",
    title: "Jack O' Lantern's Pumpkins",
    blurb: "Find his pumpkins, then carve one clean.",
    giver: "jack-o-lantern",
    steps: [
      talkTo("jack-o-lantern", "Meet Jack O' Lantern"),
      collects(FOUND_COUNTER, PUMPKINS_PER_HUNT, `Find ${PUMPKINS_PER_HUNT} pumpkins in the city`),
      earns("carve", "Carve one cleanly", "hat", "Pumpkin_head"),
    ],
    reward: { category: "hat", id: "Pumpkin_head", name: "Pumpkin Head" },
  },
  {
    id: "stbr-crew",
    title: "The Superteam Brasil Crew",
    blurb: "Meet everyone working the Brazilian boardwalk.",
    giver: "guarana",
    steps: STBR_CREW.map(([id, label]) => talkTo(id, label)),
    reward: { category: "tshirt", id: "Brazilian_shirt", name: "Brazil Shirt" },
  },
  {
    id: "kuka-hello",
    title: "Say Hello to Kuka",
    blurb: "The first person on the Brazilian beach.",
    giver: "kuka",
    steps: [talkTo("kuka", "Talk to Kuka")],
    reward: { category: "tshirt", id: "STB_shirt", name: "Superteam Brasil Shirt" },
  },
  {
    id: "kite-clash-win",
    title: "Beat Kite Pro",
    blurb: "Win a round of Kite Clash on the beach.",
    giver: "kite-pro",
    steps: [earns("win", "Win a round of Kite Clash", "hat", "STB_cap")],
    reward: { category: "hat", id: "STB_cap", name: "Superteam Brasil Cap" },
  },
  {
    id: "hair-specialist-cut",
    title: "A New Look",
    blurb: "Sit in the chair and let the cut land.",
    giver: "hair-specialist",
    steps: [earns("cut", "Finish a cut that lands", "hat", "turkish_head")],
    reward: { category: "hat", id: "turkish_head", name: "Turkish Hat" },
  },
  {
    id: "vibhu-breakpoint",
    title: "Vibhu's Invitation",
    blurb: "Open the link he hands you.",
    giver: "vibhu",
    steps: [earns("link", "Open Vibhu's Breakpoint link", "tshirt", "Shirt_Solana")],
    reward: { category: "tshirt", id: "Shirt_Solana", name: "Solana Shirt" },
  },
  {
    id: "seeker-hat",
    title: "The Seeker Lover's Gift",
    blurb: "Hold any SKR at all, then go and say hello.",
    giver: "seeker-lover",
    steps: [
      talkTo("seeker-lover", "Talk to the Seeker Lover"),
      earns("hold", "Be holding SKR when you do", "hat", "Seeker_hat"),
    ],
    reward: { category: "hat", id: "Seeker_hat", name: "Seeker Hat" },
  },
  {
    id: "seeker-backpack",
    title: "A Real Position",
    blurb: "The backpack is for more than a single token.",
    giver: "seeker-lover",
    steps: [earns("hold", "Hold 7,000 SKR or more", "back", "Seeker_backpack")],
    reward: { category: "back", id: "Seeker_backpack", name: "Seeker Backpack" },
  },
  {
    id: "stocklana-first-trade",
    title: "Your First Trade",
    blurb: "Buy or sell anything at Stocklana.",
    steps: [earns("trade", "Trade a stock at Stocklana", "accessory", "Trader_shades")],
    reward: { category: "accessory", id: "Trader_shades", name: "Trader Shades" },
  },
  {
    id: "streak-7",
    title: "A Week in the City",
    blurb: "Come back seven days running.",
    steps: [streakOf(7)],
    reward: { category: "hat", id: "Cap_Sol", name: "Cap Sol" },
  },
  {
    id: "pumpkin-carving",
    title: "Carve a Pumpkin",
    blurb: "Jack O' Lantern wants a clean carve.",
    giver: "jack-o-lantern",
    steps: [earns("carve", "Finish a clean carve", "hat", "Pumpkin_head")],
    reward: { category: "hat", id: "Pumpkin_head", name: "Pumpkin Head" },
  },
  {
    id: "ore-strike",
    title: "Strike ORE",
    blurb: "Staking a claim is a bet. Winning is the trophy.",
    steps: [earns("strike", "Win ORE out of a claim", "hat", "Miner_helmet")],
    reward: { category: "hat", id: "Miner_helmet", name: "Miner Helmet" },
  },
];

/**
 * Deliberately NOT here, and both would show the player a goal they cannot
 * reach:
 *
 * The **City Cap**. Its donation route was dropped on 2026-10-20 because the
 * code and the Donation Manager both promise that donations buy nothing, and
 * a replacement condition is the owner's call. The reward still exists.
 *
 * The **Jetpack**. It is marked as a quest reward in the wardrobe and nothing
 * in the codebase grants it. A quest with no condition is worse than no quest.
 */

export function questById(id: string): QuestDef | undefined {
  return QUESTS.find((q) => q.id === id);
}

/** Quests a given NPC announces. */
export function questsFrom(npcId: string): QuestDef[] {
  return QUESTS.filter((q) => q.giver === npcId);
}

// ── Progress ────────────────────────────────────────────────────────────────

export interface StepProgress {
  step: QuestStep;
  done: boolean;
}

export interface QuestProgress {
  /** Steps finished. */
  done: number;
  total: number;
  complete: boolean;
  steps: StepProgress[];
}

/**
 * Where a player is on a quest.
 *
 * `complete` is derived from the steps rather than from owning the reward, so
 * a quest with an undelivered reward still reads as finished. The Miner Helmet
 * has no sprite yet, and the grant skips any reward whose variant is missing:
 * asking "do you own it" would leave that quest permanently at zero even for
 * somebody who did the thing.
 */
export function questProgress(def: QuestDef, ctx: QuestContext): QuestProgress {
  const steps = def.steps.map((step) => ({ step, done: step.done(ctx) }));
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, complete: done === steps.length, steps };
}

/** Every quest with its progress, for a list the player can read. */
export function allQuestProgress(ctx: QuestContext): { def: QuestDef; progress: QuestProgress }[] {
  return QUESTS.map((def) => ({ def, progress: questProgress(def, ctx) }));
}
