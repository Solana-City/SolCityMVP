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
    // Proxy through our own API route — avoids CORS and caches server-side for 1h.
    const res = await fetch(`/api/earn-listings?type=${type}&take=${take}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("[superteamEarn] fetch error:", err);
    return [];
  }
}
