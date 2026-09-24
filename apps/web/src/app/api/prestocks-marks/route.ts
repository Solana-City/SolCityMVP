import { NextResponse } from "next/server";

// PreStocks' public asset list, reduced to mint -> the SPV's mark for the
// private company. Proxied because prestocks.com sends no CORS header, so the
// game canNOT read it straight from the browser. Cached briefly and shared by
// every player, which also keeps the load off their API.
export const revalidate = 30;

export async function GET() {
  try {
    const res = await fetch("https://prestocks.com/api/prestocks", {
      next: { revalidate: 30 },
      headers: { "User-Agent": "SolanaCity/1.0" },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const marks: Record<string, number> = {};
    for (const a of (await res.json()) as Array<{ contract_address?: string; markPrice?: number | string }>) {
      const mark = Number(a.markPrice);
      if (a.contract_address && mark > 0) marks[a.contract_address] = mark;
    }
    return NextResponse.json(marks, {
      headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[prestocks-marks]", err);
    // Empty rather than an error: the pre-IPO cards just show no premium.
    return NextResponse.json({}, { status: 200 });
  }
}
