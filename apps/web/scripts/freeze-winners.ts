/**
 * Sol City — take the entitlement list off Upstash and put it somewhere it
 * cannot quietly disappear.
 *
 * ── Why this exists, and why it is urgent ────────────────────────────────
 *
 * The wallets that won a seasonal item live in ONE place: the Upstash set
 * `ev:<kind>:<id>:won`. That is a free-tier key-value store, and it is the
 * only proof any of those players earned anything. There is no second copy.
 * If it is evicted, wiped by the DELETE route, lost with the account, or the
 * month's command quota runs out at the wrong moment, nobody can ever show
 * they carved a pumpkin, and the item can never honestly be handed over.
 *
 * The event closes on 2026-11-02. A claim that happens weeks later, on
 * another cluster, is only possible if the list outlives the event, so this
 * writes it to a file and the file is what every later step reads.
 *
 * ── A snapshot is a CUT, not a backup ────────────────────────────────────
 *
 * The set keeps growing while the event runs. So the file records the moment
 * it was taken and the count at that moment, and a claim says which snapshot
 * it honours. Running this twice gives two files, not one overwritten one:
 * an entitlement list you can silently overwrite is not evidence.
 *
 *   npx tsx scripts/freeze-winners.ts
 *   npx tsx scripts/freeze-winners.ts --kind minigame --id pumpkin-carving
 *
 * Needs the admin key, which only the owner has:
 *
 *   SOLCITY_ADMIN_KEY=... npx tsx scripts/freeze-winners.ts
 *
 * The request goes to the live site on purpose. The Upstash credentials are
 * only in Vercel's environment, so the deployed route is the one thing that
 * can read the set at all.
 *
 * Writes outside the repo by default. Wallet addresses are public, but the
 * list of who is OWED something is operational, and this repo is public.
 */
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const SITE = process.env.SOLCITY_SITE ?? "https://solanacity.io";
const OUT_DIR = process.env.SOLCITY_WINNERS_DIR
  ?? "C:/Users/mazza/Dev/SolCity-private/winners";

interface Snapshot {
  kind: string;
  id: string;
  /** When the cut was taken, from the route, not from this machine's clock. */
  takenAt: string;
  count: number;
  wallets: string[];
  /** Where it came from, so a file found later can be traced. */
  source: string;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const kind = arg("kind", "minigame");
  const id = arg("id", "pumpkin-carving");
  const adminKey = process.env.SOLCITY_ADMIN_KEY;

  if (!adminKey) {
    console.error("SOLCITY_ADMIN_KEY is not set. It is NAMES_ADMIN_KEY in Vercel.");
    process.exit(1);
  }

  const url = `${SITE}/api/admin/winners?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;
  console.log(`reading   ${url}`);

  const res = await fetch(url, { headers: { "x-admin-key": adminKey } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`the route answered ${res.status}. ${body.slice(0, 200)}`);
    // 401 is the usual one and it is worth naming, because the key is easy to
    // take from the wrong environment.
    if (res.status === 401) console.error("That is the admin key being wrong, not the event being empty.");
    process.exit(1);
  }

  const body = await res.json() as { wallets?: string[]; takenAt?: string; count?: number };
  const wallets = (body.wallets ?? []).slice().sort();

  // An empty list is not an error, but it is never what you meant to freeze,
  // so it stops here rather than writing a file that looks like evidence.
  if (wallets.length === 0) {
    console.error(`\nNo wallets in ev:${kind}:${id}:won. Nothing frozen.`);
    console.error("Check the kind and id before concluding nobody won.");
    process.exit(1);
  }

  const takenAt = body.takenAt ?? new Date().toISOString();
  const snapshot: Snapshot = {
    kind, id, takenAt, count: wallets.length, wallets, source: url,
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const stamp = takenAt.replace(/[:.]/g, "-");
  const file = join(OUT_DIR, `${kind}-${id}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  console.log(`\nfrozen    ${wallets.length} wallets`);
  console.log(`takenAt   ${takenAt}`);
  console.log(`file      ${file}`);

  // What else is already in there, so a second run is obviously a second cut
  // rather than something that replaced the first.
  const siblings = readdirSync(OUT_DIR).filter((f) => f.startsWith(`${kind}-${id}-`));
  if (siblings.length > 1) {
    console.log(`\n${siblings.length} snapshots of this event now exist:`);
    for (const s of siblings.sort()) console.log(`  ${s}`);
    console.log("The claim has to name WHICH one it honours.");
  }

  console.log("\nBack this folder up somewhere that is not this machine.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
