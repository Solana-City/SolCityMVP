import { progressionBus } from "@/game/progression/progressionBus";

export interface PlayerProfile {
  wallet: string | null;
  displayName: string;
  pfp: string | null;
  outfitId: string;
  score: number;
  swapCount: number;
  transferCount: number;
  bountyCount: number;
  unlockedOutfits: string[];
  unlockedAchievements: string[];
  visitedNPCs: string[];
  discoveredZones: string[];
  joinedAt: number;
  lastActive: number;
}

const STORAGE_KEY = "sol-city-profile";

/**
 * Manages the local player profile.
 * Persists to localStorage for session continuity.
 * In production, this syncs with on-chain state via SessionManager.
 */
export class ProfileManager {
  private profile: PlayerProfile;
  private listeners: Array<(p: PlayerProfile) => void> = [];

  constructor() {
    this.profile = this.load();
  }

  get(): PlayerProfile {
    return { ...this.profile };
  }

  setWallet(wallet: string | null): void {
    this.profile.wallet = wallet;
    if (wallet && this.profile.displayName === "Citizen") {
      this.profile.displayName = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
    }
    this.save();
  }

  setDisplayName(name: string): void {
    this.profile.displayName = name.slice(0, 20);
    this.save();
  }

  setPfp(url: string | null): void {
    this.profile.pfp = url;
    this.save();
  }

  setOutfit(outfitId: string): void {
    this.profile.outfitId = outfitId;
    this.save();
  }

  addScore(amount: number, reason: string = "action"): void {
    this.profile.score += amount;
    this.profile.lastActive = Date.now();
    this.save();
    progressionBus.emit({ type: "score-gained", amount, reason });
  }

  recordSwap(meta: { inputToken: string; outputToken: string; amount: string }): void {
    this.profile.swapCount += 1;
    const scoreGained = 50;
    this.addScore(scoreGained, "swap");
    progressionBus.emit({ type: "swap", ...meta, scoreGained });
  }

  recordTransfer(meta: { recipient: string; amount: string }): void {
    this.profile.transferCount += 1;
    const scoreGained = 25;
    this.addScore(scoreGained, "transfer");
    progressionBus.emit({ type: "transfer", ...meta, scoreGained });
  }

  recordBounty(meta?: { title?: string }): void {
    this.profile.bountyCount += 1;
    const scoreGained = 30;
    this.addScore(scoreGained, "bounty");
    progressionBus.emit({ type: "bounty", title: meta?.title, scoreGained });
  }

  /**
   * Mark an NPC as visited. Returns true on the first visit, false on
   * subsequent visits (useful for gating first-time dialog paths).
   *
   * First visit also grants a small exploration score (+5). Compared to
   * the on-chain actions (+25 to +50), this rewards discovery lightly —
   * the real economy is still anchored in real transactions.
   */
  visitNPC(npcId: string, npcName: string): boolean {
    if (this.profile.visitedNPCs.includes(npcId)) {
      progressionBus.emit({ type: "npc-visited", npcId, npcName, firstTime: false });
      return false;
    }
    this.profile.visitedNPCs.push(npcId);
    this.addScore(5, `met ${npcName}`);
    this.save();
    progressionBus.emit({ type: "npc-visited", npcId, npcName, firstTime: true });
    return true;
  }

  unlockOutfit(outfitId: string): boolean {
    if (this.profile.unlockedOutfits.includes(outfitId)) return false;
    this.profile.unlockedOutfits.push(outfitId);
    this.save();
    return true;
  }

  unlockAchievement(id: string): boolean {
    if (this.profile.unlockedAchievements.includes(id)) return false;
    this.profile.unlockedAchievements.push(id);
    this.save();
    return true;
  }

  /**
   * Wipes all progression state — score, counters, visited NPCs, unlocked
   * achievements, unlocked outfits (except default). Keeps wallet address,
   * display name, and PFP so the player isn't fully reset.
   *
   * Primarily for dev / demo use. Exposed via a visible button in
   * ProfilePanel so testing achievements from scratch doesn't require
   * DevTools.
   */
  resetProgress(): void {
    this.profile.score = 0;
    this.profile.swapCount = 0;
    this.profile.transferCount = 0;
    this.profile.bountyCount = 0;
    this.profile.visitedNPCs = [];
    this.profile.unlockedAchievements = [];
    this.profile.unlockedOutfits = ["default"];
    this.profile.outfitId = "default";
    this.save();
  }

  onChange(cb: (p: PlayerProfile) => void): void {
    this.listeners.push(cb);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
    } catch {}
    for (const cb of this.listeners) cb(this.get());
    progressionBus.emit({ type: "profile-updated", profile: this.get() });
  }

  private load(): PlayerProfile {
    const defaults: PlayerProfile = {
      wallet: null,
      displayName: "Citizen",
      pfp: null,
      outfitId: "default",
      score: 0,
      swapCount: 0,
      transferCount: 0,
      bountyCount: 0,
      unlockedOutfits: ["default"],
      unlockedAchievements: [],
      visitedNPCs: [],
      discoveredZones: [],
      joinedAt: Date.now(),
      lastActive: Date.now(),
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // Merge with defaults so older stored profiles gain the new
        // fields without wiping existing progress.
        return { ...defaults, ...JSON.parse(raw) };
      }
    } catch {}
    return defaults;
  }
}

/**
 * Singleton instance. We used to spin up a ProfileManager inside
 * CityScene, but UI surfaces (ActionPanel, HUD, toasts, etc.) live in
 * React and can't reach Phaser's registry easily. Exporting a singleton
 * gives both sides access to the same state without prop drilling.
 *
 * CityScene still accepts the singleton via `this.registry.set(...)`
 * so the Phaser side stays backwards-compatible.
 */
export const profileManager =
  typeof window === "undefined"
    ? (null as unknown as ProfileManager) // SSR guard
    : new ProfileManager();
