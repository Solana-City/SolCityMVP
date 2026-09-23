import { NextRequest, NextResponse } from "next/server";
import { recordEvent, type EventKind, type GameEvent } from "@/lib/analytics/events";
import { ANALYTICS_ON, alwaysRecorded } from "@/lib/analytics/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gameplay events from the client: which protocol was opened or used, how a
 * mini-game round went, who found the hidden citizen.
 *
 * Public by necessity (the game has no server session), so it is written to be
 * boring to abuse: only known event kinds, ids and wallets are accepted, the
 * value is clamped, and nothing here grants anything. A faked event can only
 * inflate a counter, never a reward, and the on-chain numbers in the same
 * panel are the ones that decide anything.
 *
 * POST { kind, id, wallet, value?, success?, label? }  or  { events: [...] }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const list: unknown[] = Array.isArray((body as { events?: unknown[] }).events)
    ? (body as { events: unknown[] }).events.slice(0, 10)
    : [body];

  let stored = 0;
  for (const raw of list) {
    const e = raw as Partial<GameEvent>;
    if (!e || typeof e.kind !== "string" || typeof e.id !== "string" || typeof e.wallet !== "string") continue;
    if (!ANALYTICS_ON && !alwaysRecorded(e.kind)) continue;
    const ok = await recordEvent({
      kind: e.kind as EventKind,
      id: e.id,
      wallet: e.wallet,
      value: typeof e.value === "number" ? e.value : undefined,
      success: typeof e.success === "boolean" ? e.success : undefined,
      label: typeof e.label === "string" ? e.label : undefined,
    }).catch(() => false);
    if (ok) stored++;
  }
  return NextResponse.json({ ok: true, stored });
}
