import { NextRequest, NextResponse } from "next/server";
import { writeFlag } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sets one content toggle. `value: null` clears it back to its default.
 *
 * POST { id: "pvp", value: true | false | null }
 * Requires `x-admin-key: <NAMES_ADMIN_KEY>`.
 */
export async function POST(req: NextRequest) {
  const key = process.env.NAMES_ADMIN_KEY;
  if (!key || req.headers.get("x-admin-key") !== key) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = String((body as { id?: string }).id ?? "");
  const raw = (body as { value?: boolean | null }).value;
  const value = raw === null ? null : !!raw;
  try {
    return NextResponse.json({ ok: true, flags: await writeFlag(id, value) });
  } catch (err) {
    return NextResponse.json({ ok: false, message: (err as Error).message }, { status: 400 });
  }
}
