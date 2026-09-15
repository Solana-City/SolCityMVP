import { NextRequest, NextResponse } from "next/server";

/**
 * Live Superteam Earn listings, proxied (their API has no CORS for us).
 *
 * How their public API actually behaves, checked against the live site:
 *   - /api/listings ignores `type` and `take`: it always returns the same
 *     mixed homepage batch. The category is chosen with `tab=` instead
 *     (bounties / projects / hackathons), and the hackathon tab mixes in
 *     other types, so results are still filtered by `type`.
 *   - Grants are not listings at all: they come from /api/grants.
 *   - A listing's page is superteam.fun/earn/listing/<slug> (singular); a
 *     grant's is superteam.fun/earn/grants/<slug>. The old
 *     earn.superteam.fun/listings/<slug> links 404.
 *
 * Cached for 10 minutes (was an hour, plus a day of stale-while-revalidate
 * on the CDN, which is why closed bounties lingered).
 */
export const revalidate = 600;

const TAB: Record<string, string> = { bounty: "bounties", project: "projects", hackathon: "hackathons" };
const UA = { "User-Agent": "SolanaCity/1.0" };

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "bounty";
  const take = Math.min(Math.max(parseInt(searchParams.get("take") ?? "8", 10) || 8, 1), 20);

  try {
    let listings;
    if (type === "grant") {
      const res = await fetch("https://earn.superteam.fun/api/grants", { next: { revalidate }, headers: UA });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const raw: any[] = await res.json();
      listings = (Array.isArray(raw) ? raw : [])
        .filter((g) => g?.slug && g?.title)
        .slice(0, take)
        .map((g) => ({
          title: g.title,
          rewardAmount: g.maxReward ?? g.minReward ?? null,
          token: g.token ?? "USDC",
          deadline: null,
          sponsorName: g.sponsor?.name ?? "",
          slug: g.slug,
          type: "grant",
          url: `https://superteam.fun/earn/grants/${g.slug}`,
        }));
    } else {
      const tab = TAB[type] ?? "bounties";
      const res = await fetch(`https://earn.superteam.fun/api/listings?tab=${tab}`, { next: { revalidate }, headers: UA });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const data = await res.json();
      const raw: any[] = Array.isArray(data) ? data : (data.data ?? data.listings ?? []);
      const now = Date.now();
      listings = raw
        .filter((item) => item?.slug && item.type === type)
        // Only what can still be entered: open and before its deadline.
        .filter((item) => (item.status ?? "OPEN") === "OPEN")
        .filter((item) => !item.deadline || new Date(item.deadline).getTime() > now)
        .sort((a, b) => new Date(a.deadline ?? 8.64e15).getTime() - new Date(b.deadline ?? 8.64e15).getTime())
        .slice(0, take)
        .map((item) => ({
          title: item.title ?? "",
          rewardAmount: item.rewardAmount ?? null,
          token: item.token ?? "USDC",
          deadline: item.deadline ?? null,
          sponsorName: item.sponsor?.name ?? "",
          slug: item.slug,
          type: item.type,
          url: `https://superteam.fun/earn/listing/${item.slug}`,
        }));
    }

    return NextResponse.json(listings, {
      headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[earn-listings]", err);
    return NextResponse.json([], { status: 200 });
  }
}
