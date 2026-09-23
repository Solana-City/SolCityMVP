import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { dmMessage, type DmAction } from "@/lib/dm/dmMessage";
import {
  DM_MAX_LEN, MAX_AGE_MS, poll, send, setDmsOff, storeMode, verifyEd25519,
  verifySessionOwner, walletForName, type SendOutcome,
} from "@/lib/dm/dmStore";
import { containsLink } from "@/game/chat/linkFilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEND_TEXT: Record<Exclude<SendOutcome, "sent">, string> = {
  unauthorized: "Could not verify your session. Try again in a moment.",
  off: "This player doesn't accept direct messages.",
  rate: "Slow down a little.",
};

function isWallet(s: string): boolean {
  try { return new PublicKey(s).toBase58() === s; } catch { return false; }
}

/** GET ?resolve=<nickname> -> { wallet } */
export async function GET(req: NextRequest) {
  if (storeMode() === "off") return NextResponse.json({ enabled: false, wallet: null });
  const name = req.nextUrl.searchParams.get("resolve") ?? "";
  if (!name.trim()) return NextResponse.json({ enabled: true, wallet: null });
  try {
    return NextResponse.json({ enabled: true, wallet: await walletForName(name) });
  } catch (err) {
    console.error("[dm] resolve", err);
    return NextResponse.json({ enabled: false, wallet: null });
  }
}

/**
 * POST { action, wallet, sessionKey, ts, signature, to?, text?, off? }
 * Signed by the session key over dmMessage(...).
 */
export async function POST(req: NextRequest) {
  if (storeMode() === "off") {
    return NextResponse.json({ ok: false, message: "Direct messages are not available right now." }, { status: 503 });
  }
  let body: {
    action?: DmAction; wallet?: string; sessionKey?: string; ts?: number; signature?: string;
    to?: string; text?: string; off?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 }); }

  const action = body.action;
  const wallet = String(body.wallet ?? "");
  const sessionKey = String(body.sessionKey ?? "");
  const ts = Number(body.ts ?? 0);
  if (!action || !["poll", "send", "settings"].includes(action) || !isWallet(wallet) || !isWallet(sessionKey) || !body.signature) {
    return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  }
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_AGE_MS) {
    return NextResponse.json({ ok: false, message: "Request expired." }, { status: 400 });
  }
  const extra = { to: body.to, text: body.text, off: body.off };
  if (!verifyEd25519(sessionKey, dmMessage(action, wallet, ts, extra), body.signature)) {
    return NextResponse.json({ ok: false, message: "Signature check failed." }, { status: 401 });
  }

  try {
    if (action === "poll") {
      const res = await poll(wallet, sessionKey);
      // `retry`: the session key is probably still being authorized on-chain,
      // which happens seconds after a player enters. The client comes back
      // quickly for those rather than waiting out its long backoff.
      if (!res.ok) return NextResponse.json({ ok: false, retry: true, message: SEND_TEXT.unauthorized }, { status: 401 });
      return NextResponse.json(res);
    }

    if (action === "settings") {
      if (!(await verifySessionOwner(wallet, sessionKey))) {
        return NextResponse.json({ ok: false, message: SEND_TEXT.unauthorized }, { status: 401 });
      }
      await setDmsOff(wallet, !!body.off);
      return NextResponse.json({ ok: true, off: !!body.off });
    }

    const to = String(body.to ?? "");
    const text = String(body.text ?? "").trim();
    if (!isWallet(to)) return NextResponse.json({ ok: false, message: "Unknown player." }, { status: 400 });
    if (to === wallet) return NextResponse.json({ ok: false, message: "You can't message yourself." }, { status: 400 });
    if (!text || text.length > DM_MAX_LEN) return NextResponse.json({ ok: false, message: "Message is empty or too long." }, { status: 400 });
    if (containsLink(text)) return NextResponse.json({ ok: false, message: "Links are not allowed in messages." }, { status: 400 });
    const outcome = await send(wallet, sessionKey, to, text);
    if (outcome !== "sent") return NextResponse.json({ ok: false, outcome, message: SEND_TEXT[outcome] }, { status: 200 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[dm]", action, err);
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }
}
