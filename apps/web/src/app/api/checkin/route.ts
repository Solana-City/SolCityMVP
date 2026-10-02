import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { checkinMessage } from "@/lib/checkinMessage";
import { verifyEd25519, verifySessionOwner } from "@/lib/auth/sessionAuth";
import { checkIn, readStreak, storeMode } from "@/lib/streak";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE_MS = 60_000;

function isWallet(s: string): boolean {
  try { return new PublicKey(s).toBase58() === s; } catch { return false; }
}

/**
 * GET ?wallet=<w> -> { streak, serverTs } (read only)
 *
 * `serverTs` is this server's clock, and it is on every response on purpose:
 * the POST below signs a timestamp and refuses one older than a minute, so a
 * player whose machine is a minute out could never check in. The client reads
 * this and signs with the corrected clock (lib/clockSkew.ts).
 */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  const serverTs = Date.now();
  if (storeMode() === "off" || !isWallet(wallet)) {
    return NextResponse.json({ enabled: storeMode() !== "off", streak: null, serverTs });
  }
  try {
    return NextResponse.json({ enabled: true, streak: await readStreak(wallet), serverTs });
  } catch (err) {
    console.error("[checkin] read", err);
    return NextResponse.json({ enabled: false, streak: null, serverTs });
  }
}

/**
 * POST { wallet, sessionKey, ts, signature } -> { streak }
 * Signed by the session key, so nobody can keep someone else's streak alive
 * and a future streak reward cannot be farmed from a script.
 */
export async function POST(req: NextRequest) {
  if (storeMode() === "off") return NextResponse.json({ ok: false, message: "Unavailable." }, { status: 503 });
  let body: { wallet?: string; sessionKey?: string; ts?: number; signature?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const wallet = String(body.wallet ?? "");
  const sessionKey = String(body.sessionKey ?? "");
  const ts = Number(body.ts ?? 0);
  if (!isWallet(wallet) || !isWallet(sessionKey) || !body.signature || !Number.isFinite(ts)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (Math.abs(Date.now() - ts) > MAX_AGE_MS) {
    // Almost always a clock, not an attack. Hand back ours and ask for one
    // more try: the client corrects itself and signs again (lib/clockSkew.ts).
    // This used to be a flat rejection, and a player 63 seconds behind lost
    // their streak for eight days without a word on screen.
    return NextResponse.json(
      { ok: false, retry: true, serverTs: Date.now(), message: "Expired." },
      { status: 400 },
    );
  }
  if (!verifyEd25519(sessionKey, checkinMessage(wallet, ts), body.signature)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    // The session key may not be authorized on-chain yet in the first seconds
    // after connecting; the client retries.
    if (!(await verifySessionOwner(wallet, sessionKey))) return NextResponse.json({ ok: false, retry: true }, { status: 401 });
    return NextResponse.json({ ok: true, streak: await checkIn(wallet) });
  } catch (err) {
    console.error("[checkin]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
