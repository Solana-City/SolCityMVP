import { NextRequest, NextResponse } from "next/server";
import { crankHuntIfExpired, readHunt } from "@/lib/hunt/crank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The state of the global Find Someone round, and a way to push it forward.
 *
 * GET  → round, deadline, how overdue it is, and whether a crank key is set.
 * POST → cranks it now if it is overdue (the same call the board read makes).
 *
 * Both require `x-admin-key: <NAMES_ADMIN_KEY>`. Reading is gated too, not
 * because the round is a secret — every client reads it off the chain — but
 * because this is the panel's endpoint and it costs an RPC call per request.
 */
async function authed(req: NextRequest): Promise<boolean> {
  const key = process.env.NAMES_ADMIN_KEY;
  return !!key && req.headers.get("x-admin-key") === key;
}

export async function GET(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, hunt: await readHunt() });
}

export async function POST(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false }, { status: 401 });
  const result = await crankHuntIfExpired(true);
  return NextResponse.json({ ok: true, result, hunt: await readHunt() });
}
