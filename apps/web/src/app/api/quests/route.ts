import { NextRequest, NextResponse } from "next/server";
import { authorizeSigned } from "@/lib/auth/requestAuth";
import { questMessage, type QuestAction } from "@/lib/auth/requestMessages";
import { advanceQuest, claimQuestPoints, readQuests, readMine } from "@/lib/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const QUEST_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

/** GET /api/quests?wallet=<w> — today's progress and the player's points. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  if (!WALLET_RE.test(wallet)) return NextResponse.json({ ok: false, quests: {} }, { status: 400 });
  const [quests, points] = await Promise.all([
    readQuests(wallet).catch(() => ({})),
    readMine("quests", wallet).catch(() => null),
  ]);
  return NextResponse.json({ ok: true, quests, points: points?.value ?? 0, rank: points?.rank ?? null });
}

/**
 * POST { wallet, questId, action: "increment" | "claim", target?, points?,
 *        sessionKey, ts, signature }
 *
 * Signed by the session key over questMessage(...), so progress and points can
 * only be written for the wallet that is actually playing (the same scheme as
 * /api/checkin). Values are still clamped in `lib/boards`.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { questId, action, target, points } = body as Record<string, unknown>;

  const kind: QuestAction = action === "claim" ? "claim" : "increment";
  const auth = await authorizeSigned(body as Record<string, unknown>, (w, ts) =>
    questMessage(kind, w, String(questId ?? ""), ts, { target, points }),
  );
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const wallet = auth.wallet;

  if (typeof questId !== "string" || !QUEST_RE.test(questId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (action === "claim") {
    const banked = await claimQuestPoints(wallet, questId, Number(points ?? 0)).catch(() => 0);
    return NextResponse.json({ ok: true, points: banked, quests: await readQuests(wallet) });
  }

  const row = await advanceQuest(wallet, questId, Number(target ?? 1)).catch(() => null);
  return NextResponse.json({ ok: !!row, quest: row, quests: await readQuests(wallet) });
}
