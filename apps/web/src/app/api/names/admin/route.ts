import { NextRequest, NextResponse } from "next/server";
import { blockWord, lock, namesFor, storeMode, unlock, walletLock } from "@/lib/names/nameStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team-only nickname moderation (the developer panel will call this).
 * Requires header `x-admin-key: <NAMES_ADMIN_KEY>`.
 *
 * POST { action: "lock", name? | wallet?, reason }   take a name away and lock it
 * POST { action: "unlock", name?, wallet? }          lift a lock
 * POST { action: "block-word" | "unblock-word", word } manage extra banned words
 * POST { action: "lookup", wallet }                   current name + lock state
 *
 * Example:
 *   curl -X POST https://solanacity.io/api/names/admin \
 *     -H "x-admin-key: $NAMES_ADMIN_KEY" -H "content-type: application/json" \
 *     -d '{"action":"lock","name":"BadName","reason":"offensive"}'
 */
export async function POST(req: NextRequest) {
  const key = process.env.NAMES_ADMIN_KEY;
  if (!key || req.headers.get("x-admin-key") !== key) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (storeMode() === "off") return NextResponse.json({ ok: false, message: "store not configured" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const { action, name, wallet, reason, word } = body as Record<string, string | undefined>;
  switch (action) {
    case "lock":
      if (!name && !wallet) break;
      return NextResponse.json({ ok: true, ...(await lock({ name, wallet }, reason ?? "moderation")) });
    case "unlock":
      if (!name && !wallet) break;
      await unlock({ name, wallet });
      return NextResponse.json({ ok: true });
    case "block-word":
    case "unblock-word":
      if (!word) break;
      return NextResponse.json({ ok: true, words: await blockWord(word, action === "block-word") });
    case "lookup":
      if (!wallet) break;
      return NextResponse.json({ ok: true, name: (await namesFor([wallet]))[wallet] ?? null, locked: await walletLock(wallet) });
  }
  return NextResponse.json({ ok: false, message: "bad request" }, { status: 400 });
}
