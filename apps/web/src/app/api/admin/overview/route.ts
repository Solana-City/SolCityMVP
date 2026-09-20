import { NextRequest, NextResponse } from "next/server";
import { allNames, nameCount, namesFor, storeMode } from "@/lib/names/nameStore";
import { FLAGS, readFlags } from "@/lib/flags";
import { mechsStatus, onlinePlayers, walletBalances } from "@/lib/admin/onchain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the developer panel shows, in one request: who is online, what
 * the Sol Mechs program is doing, the nickname registry and the flags.
 *
 * Requires `x-admin-key: <NAMES_ADMIN_KEY>` — the same key the moderation
 * route uses, so there is one secret to manage.
 */
export async function GET(req: NextRequest) {
  const key = process.env.NAMES_ADMIN_KEY;
  if (!key || req.headers.get("x-admin-key") !== key) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const [players, mechs, wallets, flags, names, count] = await Promise.all([
    onlinePlayers(),
    mechsStatus(),
    walletBalances().catch(() => []),
    readFlags(),
    allNames().catch(() => [] as string[]),
    nameCount().catch(() => 0),
  ]);

  // Which of the online wallets have claimed a nickname.
  const claimed: Record<string, string> = await namesFor(players.players.map((p) => p.wallet))
    .catch(() => ({} as Record<string, string>));

  return NextResponse.json({
    ok: true,
    store: storeMode(),
    city: {
      online: players.players.length,
      players: players.players.slice(0, 50).map((p) => ({ ...p, nickname: claimed[p.wallet] ?? null })),
      error: players.error ?? null,
    },
    mechs,
    wallets,
    names: { count, list: names.slice(0, 200) },
    flags,
    flagDefs: FLAGS,
  });
}
