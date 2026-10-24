import { NextRequest, NextResponse } from "next/server";
import { EVENT_KINDS, type EventKind } from "@/lib/analytics/events";
import { sismember, storeMode } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether one wallet has already won one thing.
 *
 * `ev:<kind>:<id>:won` is written at the end of any successful attempt (see
 * lib/analytics/events.ts) and is what a mint reads later. This is the same
 * set, asked about a single wallet, so the city can give back a reward that
 * lives in localStorage and was lost with the browser.
 *
 * GET /api/won?kind=minigame&id=pumpkin-carving&wallet=<pubkey>
 *   -> { ok: true, won: boolean }
 *
 * Public, and deliberately narrow. It answers only the question it is asked:
 * a yes or no about one wallet the asker already named. The admin snapshot at
 * /api/admin/winners is what returns the LIST, and it still needs a key, since
 * handing out every winner's address is a different thing entirely.
 *
 * `kind` and `id` are checked against the same allowlist and pattern the
 * writer validates with, so this can never be pointed at an arbitrary key.
 * It only reads.
 */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = String(q.get("kind") ?? "");
  const id = String(q.get("id") ?? "");
  const wallet = String(q.get("wallet") ?? "");

  if (!EVENT_KINDS.includes(kind as EventKind)) {
    return NextResponse.json({ ok: false, message: `unknown kind "${kind}"` }, { status: 400 });
  }
  if (!ID_RE.test(id) || !WALLET_RE.test(wallet)) {
    return NextResponse.json({ ok: false, message: "bad id or wallet" }, { status: 400 });
  }
  // "Off" is not "no". A caller that cannot tell the difference would treat a
  // store that is switched off as proof the player never won.
  if (storeMode() === "off") {
    return NextResponse.json({ ok: false, message: "store is off" }, { status: 503 });
  }

  try {
    const won = await sismember(`ev:${kind}:${id}:won`, wallet);
    return NextResponse.json({ ok: true, won }, {
      headers: { "cache-control": "private, max-age=30" },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, message: (err as Error).message }, { status: 500 });
  }
}
