import { NextRequest, NextResponse } from "next/server";

import { DONATION_WALLET, readDonations } from "@/lib/donations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The donation board for the Donation Manager.
 *
 * GET /api/donations?limit=10
 *
 * Public, and deliberately read-only: donating is something a player does
 * with their own wallet straight to the address, so there is nothing here to
 * post to and no way for a request to put a name on the board that the chain
 * does not already show.
 *
 * The reading is cached in lib/donations, so a city full of players opening
 * the panel is still one walk of the wallet's history every five minutes.
 */
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 10);
  const board = await readDonations(Number.isFinite(limit) ? limit : 10);

  return NextResponse.json(
    { wallet: DONATION_WALLET, ...board },
    // Donations are not urgent to the second, and the client polls on open.
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
