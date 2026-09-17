import { NextRequest, NextResponse } from "next/server";
import { readBoard, readMine } from "@/lib/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A city-wide board, with nicknames already resolved.
 *
 * GET /api/leaderboard?board=hunt|quests|game:kite-clash&limit=10&wallet=<me>
 *
 * Public: these are the scores the game shows to everyone anyway. `wallet`
 * adds that player's own value and place, so a client does not have to pull
 * the whole board to show "you are 7th".
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const board = q.get("board") ?? "hunt";
  const limit = Number(q.get("limit") ?? 10);
  const wallet = q.get("wallet");

  const rows = await readBoard(board, Number.isFinite(limit) ? limit : 10).catch(() => []);
  const mine = wallet ? await readMine(board, wallet).catch(() => null) : null;

  return NextResponse.json({ board, rows, mine }, {
    headers: { "Cache-Control": "public, max-age=15" },
  });
}
