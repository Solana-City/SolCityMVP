export type EarnListingType = "bounty" | "project" | "grant" | "hackathon";

export interface EarnListing {
  title: string;
  rewardAmount: number | null;
  token: string;
  deadline: string | null;
  sponsorName: string;
  slug: string;
  type: EarnListingType;
}

export async function fetchEarnListings(
  type: EarnListingType,
  take = 5
): Promise<EarnListing[]> {
  try {
    // Fetch a larger pool then filter client-side — the server ignores the type
    // param when no listings of that type are open, returning all open listings.
    const pool = Math.max(take * 5, 25);
    const url = `https://superteam.fun/api/listings?type=${type}&status=open&take=${pool}&order=desc`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items: any[] = Array.isArray(data)
      ? data
      : (data.data ?? data.listings ?? []);
    return items
      .filter((item: any) => (item.type ?? type) === type)
      .slice(0, take)
      .map((item: any) => ({
        title: item.title ?? "",
        rewardAmount: item.rewardAmount ?? null,
        token: item.token ?? "USDC",
        deadline: item.deadline ?? null,
        sponsorName: item.sponsor?.name ?? item.sponsorName ?? "",
        slug: item.slug ?? "",
        type,
      }));
  } catch (err) {
    console.error("[superteamEarn] fetch error:", err);
    return [];
  }
}
