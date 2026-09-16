import { NextResponse } from "next/server";
import { readFlags } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The current content toggles, for the game to read. Public: a flag says what
 * is switched on, never anything secret. Falls back to the defaults when the
 * store is not configured, so the game behaves normally either way.
 */
export async function GET() {
  return NextResponse.json({ flags: await readFlags() }, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
