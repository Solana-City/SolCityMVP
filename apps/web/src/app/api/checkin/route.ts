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

/** GET ?wallet=<w> -> { streak } (read only) */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  if (storeMode() === "off" || !isWallet(wallet)) return NextResponse.json({ enabled: storeMode() !== "off", streak: null });
  try {
    return NextResponse.json({ enabled: true, streak: await readStreak(wallet) });
  } catch (err) {
    console.error("[checkin] read", err);
    return NextResponse.json({ enabled: false, streak: null });
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
  if (Math.abs(Date.now() - ts) > MAX_AGE_MS) return NextResponse.json({ ok: false, message: "Expired." }, { status: 400 });
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
