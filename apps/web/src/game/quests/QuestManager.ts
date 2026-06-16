export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  target: number;
  rewardLabel: string;
}

export interface QuestProgress {
  questId: string;
  current: number;
  completed: boolean;
  claimedAt?: number;
}

export const DAILY_QUESTS: QuestDefinition[] = [
  {
    id: "hunt_3_npcs",
    title: "People Watcher",
    description: "Find 3 NPCs in Where's the NPC",
    target: 3,
    rewardLabel: "Daily Complete",
  },
];

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function storageKey(wallet: string): string {
  return `solcity:quests:${todayKey()}:${wallet}`;
}

export function getQuestProgress(wallet: string): Record<string, QuestProgress> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(storageKey(wallet)) ?? "{}");
  } catch {
    return {};
  }
}

function saveProgress(wallet: string, data: Record<string, QuestProgress>): void {
  localStorage.setItem(storageKey(wallet), JSON.stringify(data));
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

export function claimQuest(wallet: string, questId: string): void {
  const all = getQuestProgress(wallet);
  if (all[questId]?.completed) {
    all[questId].claimedAt = Date.now();
    saveProgress(wallet, all);
  }
}
