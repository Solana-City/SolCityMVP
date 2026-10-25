import { NextRequest, NextResponse } from "next/server";
import { EVENT_KINDS, type EventKind } from "@/lib/analytics/events";
import { del, smembers, storeMode } from "@/lib/kv";

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
 * GET    /api/admin/winners?kind=minigame&id=pumpkin-carving
 * GET    /api/admin/winners?kind=minigame&id=pumpkin-carving&format=csv
 * DELETE /api/admin/winners?kind=...&id=...&confirm=<kind>:<id>   (see below)
 * Requires `x-admin-key: <NAMES_ADMIN_KEY>`.
 *
 * `kind` and `id` are checked against the same allowlist and pattern the
 * writer validates with, so this can never be pointed at an arbitrary store
 * key.
 *
 * The answer carries `takenAt`, because a snapshot without the moment it was
 * taken is not a snapshot: the set keeps growing while the event runs, and
 * what gets minted later has to be a stated cut of it.
 *
 * ── Clearing it ───────────────────────────────────────────────────────────
 *
 * DELETE opens a season from zero, which is what the board reset does for
 * scores. It is a heavier thing than that reset, though: scores are a
 * ranking and these are entitlements, the list a tradable collectible's
 * supply is cut from. So two guards the board reset does not have.
 *
 * `confirm` must spell out the exact target, `<kind>:<id>`. A curl with the
 * wrong id in it then clears nothing instead of emptying a live season.
 *
 * And the wallets it removed come back in the answer. The delete is still a
 * delete, but an operator who ran it on the wrong event has the list in their
 * terminal rather than nowhere.
 */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

/**
 * Admin key, a known kind, a sane id and a store that is on. Returns the key
 * to work on, or the response to send back instead.
 */
function target(req: NextRequest): { key: string; kind: string; id: string } | NextResponse {
  const admin = process.env.NAMES_ADMIN_KEY;
  if (!admin || req.headers.get("x-admin-key") !== admin) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const kind = String(searchParams.get("kind") ?? "");
  const id = String(searchParams.get("id") ?? "");
  if (!EVENT_KINDS.includes(kind as EventKind)) {
    return NextResponse.json({ ok: false, message: `unknown kind "${kind}"` }, { status: 400 });
  }
  if (!ID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: `bad id "${id}"` }, { status: 400 });
  }
  if (storeMode() === "off") {
    return NextResponse.json({ ok: false, message: "store is off" }, { status: 503 });
  }
  return { key: `ev:${kind}:${id}:won`, kind, id };
}

export async function DELETE(req: NextRequest) {
  const t = target(req);
  if (t instanceof NextResponse) return t;
  const { kind, id } = t;

  const confirm = new URL(req.url).searchParams.get("confirm");
  if (confirm !== `${kind}:${id}`) {
    return NextResponse.json(
      { ok: false, message: `pass confirm=${kind}:${id} to clear this list` },
      { status: 400 },
    );
  }

  try {
    // Read before deleting, so the answer can hand back what it removed.
    const wallets = (await smembers(t.key)).sort();
    await del(t.key);
    return NextResponse.json({
      ok: true,
      kind,
      id,
      clearedAt: new Date().toISOString(),
      count: wallets.length,
      wallets,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const t = target(req);
  if (t instanceof NextResponse) return t;
  const { kind, id } = t;
  const csv = new URL(req.url).searchParams.get("format") === "csv";

  try {
    const wallets = (await smembers(t.key)).sort();
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
