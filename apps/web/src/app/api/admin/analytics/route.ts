import { NextRequest, NextResponse } from "next/server";
import { analytics } from "@/lib/admin/analytics";
import { nameCount } from "@/lib/names/nameStore";
import { eventReport } from "@/lib/analytics/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Analytics for the developer panel. Cached for a minute inside the analytics
 * module, so leaving the tab open does not hammer the RPC.
 *
 * `?force=1` recomputes. Requires `x-admin-key: <NAMES_ADMIN_KEY>`.
 */
export async function GET(req: NextRequest) {
  const key = process.env.NAMES_ADMIN_KEY;
  if (!key || req.headers.get("x-admin-key") !== key) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  const [data, names, events] = await Promise.all([
    analytics(force),
    nameCount().catch(() => 0),
    eventReport().catch(() => null),
  ]);
  return NextResponse.json({ ok: true, ...data, nicknames: names, events });
}
