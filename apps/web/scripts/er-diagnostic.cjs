#!/usr/bin/env node
/*
 * MagicBlock Ephemeral Rollup (devnet) READ-capability diagnostic for Sol City.
 *
 *   Run from apps/web:   node scripts/er-diagnostic.cjs
 *
 * The shared world needs every client to READ live state from the ER. Today the
 * client writes positions to the ER but reads other players from the base layer
 * (a comment claims ER devnet reads were unreliable). This script measures, with
 * real data, whether ER reads are usable NOW, so we pick the read-path with
 * evidence instead of a stale assumption. It tests, per endpoint:
 *   1. getVersion            — endpoint alive
 *   2. getLatestBlockhash    — latency (write-path readiness)
 *   3. getProgramAccounts    — discovery viability (many ER validators restrict it)
 *   4. accountSubscribe      — REAL-TIME reads, by watching the clock sysvar
 *                              (updates every slot; if callbacks fire, live reads work)
 */

const { Connection, PublicKey } = require("@solana/web3.js");

const ENDPOINTS = {
  router:    "https://devnet-router.magicblock.app",
  ephemeral: "https://devnet.magicblock.app",
  base:      "https://api.devnet.solana.com",
};
const PROGRAM_ID = new PublicKey("HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2");
// Clock sysvar — mutates every slot, so a working accountSubscribe fires steadily.
const CLOCK = new PublicKey("SysvarC1ock11111111111111111111111111111111");

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms (${label})`)), ms)),
  ]);

async function testEndpoint(name, url) {
  console.log(`\n=== ${name.toUpperCase()}  (${url}) ===`);
  const conn = new Connection(url, "confirmed");

  try {
    const v = await withTimeout(conn.getVersion(), 8000, "getVersion");
    console.log(`  getVersion         : OK    ${JSON.stringify(v)}`);
  } catch (e) { console.log(`  getVersion         : FAIL  ${e.message}`); }

  try {
    const t = Date.now();
    await withTimeout(conn.getLatestBlockhash(), 8000, "getLatestBlockhash");
    console.log(`  getLatestBlockhash : OK    ${Date.now() - t}ms`);
  } catch (e) { console.log(`  getLatestBlockhash : FAIL  ${e.message}`); }

  try {
    const t = Date.now();
    const accts = await withTimeout(
      conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed" }), 12000, "getProgramAccounts");
    console.log(`  getProgramAccounts : OK    ${accts.length} account(s)  ${Date.now() - t}ms`);
  } catch (e) { console.log(`  getProgramAccounts : FAIL/UNSUPPORTED  ${e.message}`); }

  await new Promise((resolve) => {
    let updates = 0;
    let subId = null;
    const started = Date.now();
    try {
      subId = conn.onAccountChange(CLOCK, () => { updates++; }, "confirmed");
    } catch (e) {
      console.log(`  accountSubscribe   : FAIL  ${e.message}`);
      return resolve();
    }
    setTimeout(async () => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (updates > 0) {
        console.log(`  accountSubscribe   : OK    ${updates} update(s) in ${secs}s  → REAL-TIME READS WORK`);
      } else {
        console.log(`  accountSubscribe   : NONE  0 updates in ${secs}s  → real-time reads NOT usable here`);
      }
      try { if (subId !== null) await conn.removeAccountChangeListener(subId); } catch {}
      resolve();
    }, 8000);
  });
}

// Phase 2 — the decisive test: subscribe to an actual ER-resident (delegated)
// program account via BOTH the router and the raw ephemeral endpoint, while
// polling its data on the ephemeral to confirm the ER copy is mutating. The
// clock sysvar isn't delegated, so it can't prove delegated-account reads; a
// real player PDA can. NOTE: if no player is moving right now, updates may be 0
// (idle) — re-run this with one browser tab walking around for a live signal.
async function testDelegatedAccountReads(seconds = 15) {
  console.log(`\n=== PHASE 2 — delegated (ER-resident) account reads (${seconds}s) ===`);
  const eph = new Connection(ENDPOINTS.ephemeral, "confirmed");

  let accts;
  try {
    accts = await withTimeout(eph.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed" }), 12000, "gPA");
  } catch (e) { console.log(`  getProgramAccounts (ephemeral): FAIL ${e.message}`); return; }
  if (!accts.length) { console.log("  No delegated accounts on the ER to test. Connect + walk in a tab, then re-run."); return; }

  console.log(`  watching ALL ${accts.length} delegated account(s) — walk around now if you can`);

  const router = new Connection(ENDPOINTS.router, "confirmed");
  let routerHits = 0, ephHits = 0, dataChanges = 0;
  const subs = [];
  const sums = new Map(); // pubkey -> {len, sum}
  for (const { pubkey, account } of accts) {
    sums.set(pubkey.toBase58(), { len: account.data.length, sum: checksum(account.data) });
    try { subs.push(["router", router.onAccountChange(pubkey, () => { routerHits++; }, "confirmed")]); } catch (e) { console.log(`  router sub FAIL ${e.message}`); }
    try { subs.push(["eph", eph.onAccountChange(pubkey, () => { ephHits++; }, "confirmed")]); } catch (e) { console.log(`  ephemeral sub FAIL ${e.message}`); }
  }

  const poll = setInterval(async () => {
    for (const { pubkey } of accts) {
      try {
        const info = await eph.getAccountInfo(pubkey, "confirmed");
        if (!info) continue;
        const key = pubkey.toBase58();
        const prev = sums.get(key);
        const sum = checksum(info.data);
        if (!prev || info.data.length !== prev.len || sum !== prev.sum) {
          dataChanges++;
          sums.set(key, { len: info.data.length, sum });
        }
      } catch { /* ignore */ }
    }
  }, 1500);

  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(poll);
  for (const [which, id] of subs) {
    try { await (which === "router" ? router : eph).removeAccountChangeListener(id); } catch {}
  }

  console.log(`  data mutated (poll)      : ${dataChanges} change(s) ${dataChanges === 0 ? "(account idle — inconclusive; re-run while moving)" : ""}`);
  console.log(`  router  accountSubscribe : ${routerHits} update(s)`);
  console.log(`  ephemeral accountSubscribe: ${ephHits} update(s)`);
  if (dataChanges > 0) {
    if (routerHits > 0) console.log("  → ROUTER delivers ER-resident updates in real time. Use the router for subscriptions.");
    else if (ephHits > 0) console.log("  → EPHEMERAL endpoint delivers ER-resident updates. Use it for subscriptions.");
    else console.log("  → data changed but NO subscription fired → subscriptions unusable; poll getProgramAccounts on ephemeral instead.");
  }
}

function checksum(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s = (s + data[i] * (i + 1)) >>> 0;
  return s;
}

(async () => {
  console.log("Sol City — MagicBlock ER devnet READ diagnostic");
  console.log("(what we need for a live shared world: reads from the ER, not base)");
  for (const [name, url] of Object.entries(ENDPOINTS)) {
    await testEndpoint(name, url);
  }
  await testDelegatedAccountReads(15);
  console.log("\n── How to read this ──────────────────────────────────────────");
  console.log("  • ephemeral: accountSubscribe OK + getProgramAccounts OK");
  console.log("      → migrate reads to the ER (best): everyone sees everyone live, sub-50ms.");
  console.log("  • ephemeral: accountSubscribe OK but getProgramAccounts unsupported");
  console.log("      → subscribe per-known-PDA on the ER; discover the roster via base.");
  console.log("  • ephemeral reads fail");
  console.log("      → keep reads on base + a shared 'world' account committed frequently,");
  console.log("        OR a thin relay (websocket) for presence while ER matures.");
  process.exit(0);
})();
