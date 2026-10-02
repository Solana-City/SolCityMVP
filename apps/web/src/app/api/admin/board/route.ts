import { NextRequest, NextResponse } from "next/server";
import { boardKey } from "@/lib/boards";
import { del } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clears one city board, so a live event can start from zero.
 *
 * The Find Someone board is cumulative: it answers "who has found the most
 * citizens, ever", which is the right question for the city and the wrong one
 * for a tournament. Running five rounds on stage and ranking the room means
 * the counting has to start when the rounds do, hence a reset the host can
 * press a minute before round one.
 *
 * POST { board: "hunt" | "quests" | "streak" | "game:<id>" }
 * Requires `x-admin-key: <NAMES_ADMIN_KEY>`.
 *
 * Only names `boardKey` recognises are accepted, so this can never be pointed
 * at an arbitrary store key. It deletes the scores and nothing else: nicknames
 * and anything on-chain are untouched, and the next find recreates the board.
 */
export async function POST(req: NextRequest) {
  const key = process.env.NAMES_ADMIN_KEY;
  if (!key || req.headers.get("x-admin-key") !== key) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const board = String((body as { board?: string }).board ?? "");
  const storeKey = boardKey(board);
  if (!storeKey) {
    return NextResponse.json({ ok: false, message: `unknown board "${board}"` }, { status: 400 });
  }

  try {
    await del(storeKey);
    return NextResponse.json({ ok: true, board, cleared: storeKey });
  } catch (err) {
    return NextResponse.json({ ok: false, message: (err as Error).message }, { status: 500 });
  }
}
