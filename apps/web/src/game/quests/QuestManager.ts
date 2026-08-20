export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  target: number;
  points: number;
  rewardLabel: string;
}

export interface QuestProgress {
  questId: string;
  current: number;
  completed: boolean;
  claimedAt?: number;
}

export interface QuestLeaderEntry {
  wallet: string;
  display: string;
  points: number;
}

export const DAILY_QUESTS: QuestDefinition[] = [
  {
    id: "hunt_3_npcs",
    title: "People Watcher",
    description: 'Find 3 citizens in "Find Someone"',
    target: 3,
    points: 300,
    rewardLabel: "300 pts",
  },
  {
    id: "swap_jupiter",
    title: "Swap King",
    description: "Make a swap with Jupiter Cat",
    target: 1,
    points: 200,
    rewardLabel: "200 pts",
  },
  {
    id: "send_steve",
    title: "Token Sender",
    description: "Send SOL with Steve Sends",
    target: 1,
    points: 200,
    rewardLabel: "200 pts",
  },
];

// ── Storage helpers ───────────────────────────────────────────────────────────

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function progressKey(wallet: string): string {
  return `solcity:quests:${todayKey()}:${wallet}`;
}

const LEADERBOARD_KEY = "solcity:questPoints";

// ── Quest progress ────────────────────────────────────────────────────────────

export function getQuestProgress(wallet: string): Record<string, QuestProgress> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(progressKey(wallet)) ?? "{}");
  } catch {
    return {};
  }
}

function saveProgress(wallet: string, data: Record<string, QuestProgress>): void {
  localStorage.setItem(progressKey(wallet), JSON.stringify(data));
}

/** Increment a quest counter. Returns updated QuestProgress. */
export function incrementQuest(wallet: string, questId: string): QuestProgress {
  const all = getQuestProgress(wallet);
  const def = DAILY_QUESTS.find(q => q.id === questId);
  if (!def) return { questId, current: 0, completed: false };

  const prev = all[questId] ?? { questId, current: 0, completed: false };
  if (prev.completed) return prev;

  const current = Math.min(prev.current + 1, def.target);
  const completed = current >= def.target;
  const next: QuestProgress = { questId, current, completed };
  all[questId] = next;
  saveProgress(wallet, all);
  return next;
}

// ── Claim + points leaderboard ────────────────────────────────────────────────

function loadLeaderboard(): Record<string, { display: string; points: number }> {
  try {
    return JSON.parse(localStorage.getItem(LEADERBOARD_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveLeaderboard(data: Record<string, { display: string; points: number }>): void {
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(data));
}

export function claimQuest(wallet: string, questId: string): number {
  const all = getQuestProgress(wallet);
  const def = DAILY_QUESTS.find(q => q.id === questId);
  if (!def || !all[questId]?.completed || all[questId]?.claimedAt) return 0;

  all[questId].claimedAt = Date.now();
  saveProgress(wallet, all);

  // Add points to leaderboard
  const lb = loadLeaderboard();
  const display = wallet.length > 8
    ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
    : wallet;
  const prev = lb[wallet] ?? { display, points: 0 };
  lb[wallet] = { display, points: prev.points + def.points };
  saveLeaderboard(lb);

  return def.points;
}

export function getQuestLeaderboard(limit = 10): QuestLeaderEntry[] {
  const lb = loadLeaderboard();
  return Object.entries(lb)
    .map(([wallet, v]) => ({ wallet, ...v }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

export function getMyQuestPoints(wallet: string): number {
  return loadLeaderboard()[wallet]?.points ?? 0;
}

export function getDailyPointsEarned(wallet: string): number {
  const all = getQuestProgress(wallet);
  return DAILY_QUESTS.reduce((sum, def) => {
    return all[def.id]?.claimedAt ? sum + def.points : sum;
  }, 0);
}
