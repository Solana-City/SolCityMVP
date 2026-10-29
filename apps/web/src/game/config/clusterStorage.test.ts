import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { clusterKey, SOLANA_CLUSTER } from "./clusterStorage";

/**
 * Every file that touches localStorage has to have decided, on purpose,
 * whether what it stores is PROGRESS or a DEVICE PREFERENCE.
 *
 * Progress carries the cluster, so mainnet starts empty. A preference does
 * not, because making somebody re-mute the music for switching cluster is
 * rude. The failure this guards against is the quiet one: somebody adds a new
 * earned thing to localStorage, forgets the namespace, and a mainnet player
 * silently inherits it from devnet. That is how a wardrobe full of items the
 * chain never granted gets in front of a player.
 *
 * A new file touching localStorage fails this test until it is classified.
 */
const SRC = join(process.cwd(), "src");

/** Stores only what describes this machine, not what the player has earned. */
const DEVICE_PREFERENCES = [
  // Sound, view, and "I have seen this card" flags.
  "game/audio/MusicManager.ts",
  "game/audio/SoundManager.ts",
  "game/config/zoomConfig.ts",
  "game/minigames/food-cart/index.tsx",
  "game/minigames/kite-clash/index.tsx",
  "game/minigames/pumpkin-carving/HowToPlay.tsx",
  "ui/CityGuide.tsx",
  "ui/CalendarPanel.tsx",
  "ui/KeysCard.tsx",
  "ui/Minimap.tsx",
  "ui/ProtocolIntro.tsx",
  "ui/ActionPanel.tsx",
  // Whether to watch packs open one card at a time. A feeling about an
  // animation, identical on every cluster, and namespacing it would only
  // make somebody say so twice.
  "ui/BoosterOverlay.tsx",
  "app/page.tsx",
  "app/privacy/page.tsx",
  // Opt-outs and drafts the player typed, which belong to the person.
  "game/chat/dmClient.ts",
  "game/chat/dmEvents.ts",
  "game/chat/claimBroadcast.ts",
  "game/chat/tradeBroadcast.ts",
  "ui/ChatPanel.tsx",
  "ui/ExpressionWheel.tsx",
  // Which exchange is selected, not what was traded.
  "game/solana/stocks.ts",
  // A cache of nicknames, which live in one off-chain store shared by every
  // cluster, so namespacing it would only cost a re-fetch.
  "game/names/nameService.ts",
  // Wallet adapter's own key, and a one-shot "why did the page reload" note.
  "ui/SolanaProvider.tsx",
  "ui/reloadReason.ts",
  "game/social/profilePublisher.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("cluster-namespaced storage", () => {
  it("suffixes progress keys off devnet, and leaves devnet alone", () => {
    // Devnet keeps the bare key on purpose: namespacing every cluster would
    // have wiped every tester the moment it shipped. The goal is that mainnet
    // starts clean, not that devnet resets.
    expect(SOLANA_CLUSTER).toBe("devnet");
    expect(clusterKey("solcity:unlocks:abc")).toBe("solcity:unlocks:abc");
  });

  it("every file using localStorage is classified", () => {
    const unclassified: string[] = [];
    for (const file of walk(SRC)) {
      const body = readFileSync(file, "utf8");
      if (!body.includes("localStorage.")) continue;
      const rel = file.slice(SRC.length + 1).split("\\").join("/");
      if (rel === "game/config/clusterStorage.ts") continue;
      const isPreference = DEVICE_PREFERENCES.includes(rel);
      const isNamespaced = body.includes("clusterKey");
      if (!isPreference && !isNamespaced) unclassified.push(rel);
    }
    // A new name here means: decide whether it is progress. If it is, wrap its
    // key in clusterKey. If it is a device preference, add it to the list.
    expect(unclassified).toEqual([]);
  });

  it("the things a player earns are namespaced", () => {
    const mustNamespace = [
      "game/config/profileManager.ts",   // score, streak, achievements
      "game/config/wardrobeUnlocks.ts",  // unlocked outfits
      "game/config/paperDoll.ts",        // the saved outfit
      "game/quests/QuestManager.ts",     // quests and quest points
      "game/buffs/playerBuffs.ts",
      "game/halloween/pumpkinHunt.ts",
      "game/minigames/pumpkin-carving/index.tsx",
      "game/minigames/whereIsNPC/WhereIsNPCGame.ts",
      "game/solmechs/hangar.ts",           // owned mechs and parts
      "game/world/lastPosition.ts",
      "ui/StockExchangePanel.tsx",         // cost basis per wallet
      // A session key authorised on one cluster is meaningless on another,
      // and reusing it would fail every signed write.
      "game/solana/sessionKeys.ts",
    ];
    for (const rel of mustNamespace) {
      const body = readFileSync(join(SRC, rel), "utf8");
      expect(body.includes("clusterKey"), rel).toBe(true);
    }
  });
});
