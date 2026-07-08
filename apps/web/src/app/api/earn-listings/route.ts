import { NextRequest, NextResponse } from "next/server";

// Revalidate cached response every hour — listings auto-update without deploys.
export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "bounty";
  const take = Math.min(parseInt(searchParams.get("take") ?? "8", 10), 20);

  try {
    const upstream = `https://earn.superteam.fun/api/listings/?type=${type}&status=open&take=${take * 4}&order=desc`;
    const res = await fetch(upstream, {
      next: { revalidate: 3600 },
      headers: { "User-Agent": "SolanaCity/1.0" },
    });

    if (!res.ok) throw new Error(`upstream ${res.status}`);

    const data = await res.json();
    const raw: any[] = Array.isArray(data)
      ? data
      : (data.data ?? data.listings ?? []);

    const listings = raw
      .filter((item: any) => !type || (item.type ?? type) === type)
      .slice(0, take)
      .map((item: any) => ({
        title: item.title ?? "",
        rewardAmount: item.rewardAmount ?? null,
        token: item.token ?? "USDC",
        deadline: item.deadline ?? null,
        sponsorName: item.sponsor?.name ?? item.sponsorName ?? "",
        slug: item.slug ?? "",
        type: item.type ?? type,
      }));

    return NextResponse.json(listings, {
      headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error("[earn-listings]", err);
    return NextResponse.json([], { status: 200 });
  }
}
