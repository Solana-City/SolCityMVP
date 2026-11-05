import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { sponsorMint, type SponsoredMintStatus } from "@/lib/mint/sponsor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to four mint transactions, each sent, rebroadcast and confirmed.
export const maxDuration = 60;

function isWallet(s: string): boolean {
  try { return new PublicKey(s).toBase58() === s; } catch { return false; }
}

const HTTP: Record<SponsoredMintStatus, number> = {
  minted: 200,
  nothing: 200,
  pending: 409,
  unavailable: 503,
  failed: 502,
};

/**
 * POST { wallet } -> SponsoredMint
 *
 * Mints what `wallet` is owed from its packs, paid by the site's sponsor
 * wallet (lib/mint/sponsor.ts). No signature is asked of anyone, on purpose:
 * the program decides what is minted and to whom, so naming a wallet can only
 * ever deliver that wallet's own items to it.
 */
export async function POST(req: NextRequest) {
  let body: { wallet?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const wallet = String(body.wallet ?? "");
  if (!isWallet(wallet)) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const result = await sponsorMint(new PublicKey(wallet));
    return NextResponse.json({ ok: result.status === "minted" || result.status === "nothing", ...result },
      { status: HTTP[result.status] });
  } catch (err) {
    console.error("[mint]", err);
    return NextResponse.json({ ok: false, status: "failed", minted: [], left: 0, signatures: [] }, { status: 500 });
  }
}
