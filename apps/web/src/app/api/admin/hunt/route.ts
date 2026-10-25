import { NextRequest, NextResponse } from "next/server";
import { readHunt } from "@/lib/hunt/readHunt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The state of the global Find Someone round.
 *
 * GET -> the round being hunted, when it rotates, and who won the last one.
 *
 * The POST that cranked an overdue round is gone with the crank itself: the
 * round is derived from a stored anchor and the clock now, so it advances on
 * its own and there is no `expire_round` left to send.
 *
 * Gated by `x-admin-key: <NAMES_ADMIN_KEY>`, not because the round is a secret
 * - every client reads it off the chain - but because this is the panel's
 * endpoint and it costs an RPC call per request.
 */
export async function GET(req: NextRequest) {
  const key = process.env.NAMES_ADMIN_KEY;
  if (!key || req.headers.get("x-admin-key") !== key) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, hunt: await readHunt() });
}
