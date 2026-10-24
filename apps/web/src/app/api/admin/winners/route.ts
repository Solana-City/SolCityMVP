import { NextRequest, NextResponse } from "next/server";
import { EVENT_KINDS, type EventKind } from "@/lib/analytics/events";
import { smembers, storeMode } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The wallets that WON a thing, for a snapshot.
 *
 * A seasonal item is earned on one cluster and handed over on another: the
 * city runs on devnet today and the Halloween hat is meant to reach mainnet
 * with the people who earned it. A wallet address is identical on both, so
 * the list of addresses is the whole of what has to survive the move, and
 * `ev:<kind>:<id>:won` is where it is kept (see lib/analytics/events.ts).
 *
 * GET /api/admin/winners?kind=minigame&id=pumpkin-carving
 * GET /api/admin/winners?kind=minigame&id=pumpkin-carving&format=csv
 * Requires `x-admin-key: <NAMES_ADMIN_KEY>`.
 *
 * `kind` and `id` are checked against the same allowlist and pattern the
 * writer validates with, so this can never be pointed at an arbitrary store
 * key. It only reads.
 *
 * The answer carries `takenAt`, because a snapshot without the moment it was
 * taken is not a snapshot: the set keeps growing while the event runs, and
 * what gets minted later has to be a stated cut of it.
 */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

export async function GET(req: NextRequest) {
  const key = process.env.NAMES_ADMIN_KEY;
  if (!key || req.headers.get("x-admin-key") !== key) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const kind = String(searchParams.get("kind") ?? "");
  const id = String(searchParams.get("id") ?? "");
  const csv = searchParams.get("format") === "csv";

  if (!EVENT_KINDS.includes(kind as EventKind)) {
    return NextResponse.json({ ok: false, message: `unknown kind "${kind}"` }, { status: 400 });
  }
  if (!ID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: `bad id "${id}"` }, { status: 400 });
  }
  if (storeMode() === "off") {
    return NextResponse.json({ ok: false, message: "store is off" }, { status: 503 });
  }

  try {
    const wallets = (await smembers(`ev:${kind}:${id}:won`)).sort();
    const takenAt = new Date().toISOString();
    if (csv) {
      // One address per line, with a header: what a mint script reads, and
      // what a spreadsheet opens.
      const body = ["wallet", ...wallets].join("\n");
      return new NextResponse(body, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${kind}-${id}-winners-${takenAt.slice(0, 10)}.csv"`,
        },
      });
    }
    return NextResponse.json({ ok: true, kind, id, takenAt, count: wallets.length, wallets });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
