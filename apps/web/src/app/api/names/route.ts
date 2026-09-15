import { NextRequest, NextResponse } from "next/server";
import { createPublicKey, verify } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { claimMessage } from "@/lib/names/claimMessage";
import { claim, namesFor, storeMode, validate, walletLock, type NameProblem } from "@/lib/names/nameStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How old a signed claim may be. */
const MAX_AGE_MS = 5 * 60_000;

const PROBLEM_TEXT: Record<NameProblem, string> = {
  length: "Use 3 to 16 characters.",
  chars: "Start with a letter. Letters, numbers and _ only.",
  offensive: "That name isn't allowed.",
  reserved: "That name is reserved.",
  taken: "That name is taken.",
  locked: "That name is locked.",
  "wallet-locked": "Your name was locked by the Solana City team.",
};

/**
 * GET ?wallets=a,b,c   -> { names: { wallet: name } }
 * GET ?check=<name>&wallet=<w> -> { available, problem?, message? }
 * GET ?status=1&wallet=<w>     -> { enabled, name, locked }
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const mode = storeMode();
  if (mode === "off") return NextResponse.json({ enabled: false, names: {} });
  try {
    if (q.get("status")) {
      const wallet = q.get("wallet") ?? "";
      const [names, lock] = await Promise.all([namesFor([wallet]), walletLock(wallet)]);
      return NextResponse.json({ enabled: true, name: names[wallet] ?? null, locked: lock });
    }
    const check = q.get("check");
    if (check !== null) {
      const problem = await validate(check.trim(), q.get("wallet") ?? undefined);
      return NextResponse.json({ available: !problem, problem, message: problem ? PROBLEM_TEXT[problem] : null });
    }
    const wallets = (q.get("wallets") ?? "").split(",").map((w) => w.trim()).filter(Boolean);
    return NextResponse.json({ enabled: true, names: await namesFor(wallets) });
  } catch (err) {
    console.error("[names]", err);
    return NextResponse.json({ enabled: false, names: {} }, { status: 200 });
  }
}

function verifySignature(wallet: string, message: string, signatureB64: string): boolean {
  try {
    const raw = new PublicKey(wallet).toBytes();
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** POST { wallet, name, ts, signature } — the wallet proves it owns the claim. */
export async function POST(req: NextRequest) {
  if (storeMode() === "off") {
    return NextResponse.json({ ok: false, message: "Nicknames are not available right now." }, { status: 503 });
  }
  let body: { wallet?: string; name?: string; ts?: number; signature?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 }); }
  const wallet = String(body.wallet ?? "");
  const name = String(body.name ?? "").trim();
  const ts = Number(body.ts ?? 0);
  if (!wallet || !name || !body.signature || !Number.isFinite(ts)) {
    return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  }
  if (Math.abs(Date.now() - ts) > MAX_AGE_MS) {
    return NextResponse.json({ ok: false, message: "Signature expired. Try again." }, { status: 400 });
  }
  if (!verifySignature(wallet, claimMessage(wallet, name, ts), body.signature)) {
    return NextResponse.json({ ok: false, message: "Signature check failed." }, { status: 401 });
  }
  try {
    const problem = await claim(wallet, name);
    if (problem) return NextResponse.json({ ok: false, problem, message: PROBLEM_TEXT[problem] }, { status: 409 });
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    console.error("[names] claim", err);
    return NextResponse.json({ ok: false, message: "Could not save. Try again." }, { status: 500 });
  }
}
