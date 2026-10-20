import { NextRequest, NextResponse } from "next/server";
import { recordEvent, type EventKind, type GameEvent } from "@/lib/analytics/events";
import { authorizeSigned } from "@/lib/auth/requestAuth";
import { eventsMessage } from "@/lib/auth/requestMessages";
import { ANALYTICS_ON, alwaysRecorded } from "@/lib/analytics/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An events array of ten small objects is well under this. */
const MAX_PAYLOAD = 8_000;

/**
 * Gameplay events from the client: which protocol was opened or used, how a
 * mini-game round went, who found the hidden citizen.
 *
 * Signed by the session key (the same scheme as /api/checkin): the `hunt`,
 * `minigame` and `purchase` kinds feed boards players see, so an unsigned
 * request must not be able to put a score on anybody's name. Only known event
 * kinds, ids and wallets are accepted and the value is clamped.
 *
 * POST { wallet, sessionKey, ts, signature, payload }
 * `payload` is the JSON text of an array of up to 10 events
 * `{ kind, id, wallet, value?, success?, label? }`, each for the signing wallet.
 * The signature covers eventsMessage(wallet, ts, payload).
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const payload = typeof body?.payload === "string" ? body.payload : "";
  const auth = await authorizeSigned(body ?? {}, (w, ts) => eventsMessage(w, ts, payload));
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let list: unknown;
  try { list = payload.length <= MAX_PAYLOAD ? JSON.parse(payload) : null; } catch { list = null; }
  if (!Array.isArray(list)) return NextResponse.json({ ok: false }, { status: 400 });
  const events = list.slice(0, 10) as unknown[];
  // One session key speaks for one wallet: an event for anybody else is a
  // forgery, so the whole request is refused before anything is written.
  if (events.some((e) => (e as Partial<GameEvent> | null)?.wallet !== auth.wallet)) {
    return NextResponse.json({ ok: false, message: "Wallet mismatch." }, { status: 401 });
  }

  let stored = 0;
  for (const raw of events) {
    const e = raw as Partial<GameEvent>;
    if (!e || typeof e.kind !== "string" || typeof e.id !== "string" || typeof e.wallet !== "string") continue;
    if (!ANALYTICS_ON && !alwaysRecorded(e.kind, e.id)) continue;
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
