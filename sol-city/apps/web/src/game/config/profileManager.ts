export interface PlayerProfile {
  wallet: string | null;
  displayName: string;
  pfp: string | null; // data URL or external URL for profile picture
  outfitId: string;
  score: number;
  swapCount: number;
  transferCount: number;
  bountyCount: number;
  unlockedOutfits: string[];
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

  addScore(amount: number): void {
    this.profile.score += amount;
    this.profile.lastActive = Date.now();
    this.save();
  }

  recordSwap(): void {
    this.profile.swapCount += 1;
    this.addScore(50);
    this.checkUnlocks();
  }

  recordTransfer(): void {
    this.profile.transferCount += 1;
    this.addScore(25);
  }

  recordBounty(): void {
    this.profile.bountyCount += 1;
    this.addScore(30);
    this.checkUnlocks();
  }

  unlockOutfit(outfitId: string): boolean {
    if (this.profile.unlockedOutfits.includes(outfitId)) return false;
    this.profile.unlockedOutfits.push(outfitId);
    this.save();
    return true;
  }

  onChange(cb: (p: PlayerProfile) => void): void {
    this.listeners.push(cb);
  }

  private checkUnlocks(): void {
    if (this.profile.swapCount >= 10) this.unlockOutfit("trader-cloak");
    if (this.profile.bountyCount >= 3) this.unlockOutfit("builder-jacket");
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
    } catch {}
    for (const cb of this.listeners) cb(this.get());
  }

  private load(): PlayerProfile {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      wallet: null,
      displayName: "Citizen",
      pfp: null,
      outfitId: "default",
      score: 0,
      swapCount: 0,
      transferCount: 0,
      bountyCount: 0,
      unlockedOutfits: ["default"],
      joinedAt: Date.now(),
      lastActive: Date.now(),
    };
  }
}
