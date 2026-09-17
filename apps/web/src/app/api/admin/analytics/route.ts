import { NextRequest, NextResponse } from "next/server";
import { analytics } from "@/lib/admin/analytics";
import { nameCount } from "@/lib/names/nameStore";
import { eventReport } from "@/lib/analytics/events";
import { hgetall } from "@/lib/kv";

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
  const [data, names, events, heatRaw] = await Promise.all([
    analytics(force),
    nameCount().catch(() => 0),
    eventReport().catch(() => null),
    hgetall("heat:cells").catch(() => ({} as Record<string, string>)),
  ]);
  const heat: Record<string, number> = {};
  for (const [cell, value] of Object.entries(heatRaw)) heat[cell] = Number(value) || 0;
  return NextResponse.json({ ok: true, ...data, nicknames: names, events, heat });
}
