import { NextRequest, NextResponse } from "next/server";
import { getStockByTicker } from "@/game/solana/stockCatalog";

// Same-origin copy of each catalog stock's logo. The issuers' logo hosts send
// no CORS headers, so the game canvas can't draw them directly; served from
// here they can. Only catalog tickers are proxied, never arbitrary URLs.
export const revalidate = 86400;

/** 1x1 fully transparent PNG, served in place of a failed upstream logo. */
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const stock = getStockByTicker(params.ticker.toUpperCase());
  if (!stock) return new NextResponse("unknown ticker", { status: 404 });

  try {
    const res = await fetch(stock.logo, {
      next: { revalidate: 86400 },
      headers: { "User-Agent": "SolanaCity/1.0" },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      },
    });
  } catch (err) {
    console.error("[stock-logo]", stock.ticker, err);
    // A transparent pixel, not a 502 with a text body. The game loads these
    // through Phaser's image loader, which hands whatever comes back to the
    // GPU — and a body of "logo unavailable" is what WebGL reports as
    // "INVALID_VALUE: texImage2D: bad image data". The caller already draws a
    // brand-coloured disc when a logo has nothing in it, so an empty image
    // lands exactly on that fallback instead of poisoning a texture.
    //
    // Cached briefly, not for a day: this is an upstream hiccup, and the real
    // logo should be allowed back as soon as it returns.
    return new NextResponse(TRANSPARENT_PNG, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=60",
      },
    });
  }
}
