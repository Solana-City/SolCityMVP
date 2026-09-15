import { NextRequest, NextResponse } from "next/server";
import { getStockByTicker } from "@/game/solana/stockCatalog";

// Same-origin copy of each catalog stock's logo. The issuers' logo hosts send
// no CORS headers, so the game canvas can't draw them directly; served from
// here they can. Only catalog tickers are proxied, never arbitrary URLs.
export const revalidate = 86400;

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
    return new NextResponse("logo unavailable", { status: 502 });
  }
}
