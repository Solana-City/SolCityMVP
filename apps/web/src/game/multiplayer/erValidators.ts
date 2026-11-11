/**
 * The ephemeral rollup validators, and which one is nearest to this player.
 *
 * ── Why there is a list and not a constant ───────────────────────────────
 *
 * The city used to pick one validator for everybody. That is a global choice
 * with no good answer: measured from Vietnam the US rollup is ~300ms and the
 * Asian one ~130ms, and from Brazil it is the other way round. Whichever is
 * picked, half the world pays for it, and two players sitting in the same room
 * pay it twice because every update travels to the rollup and back out.
 *
 * It looked unavoidable, because a transaction cannot span two validators. But
 * that constraint only bites a transaction that touches TWO delegated
 * accounts, and the shared world has almost none: position, outfit,
 * expression, chat, mini-game scores and the public profile all go through
 * `UpdatePlayerSession`, which holds exactly one account, the sender's own
 * PDA, signed by their own session key.
 *
 * Reading is not a transaction. So players can be spread across validators and
 * still see each other, as long as every client READS all of them.
 *
 * The one instruction that does span two delegated accounts is
 * `kick_ball_session` (the ball plus the kicker). The ball is a nice-to-have
 * and does not get to decide where everybody else lives; it adapts, most
 * likely by having one ball per validator.
 */

import { SOLANA_CLUSTER } from "../config/clusterStorage";

export interface ErValidator {
  /** Short, stable id. Used in logs and as a map key. */
  id: "us" | "as" | "eu";
  /** Human label for the dev panel. */
  label: string;
  rpc: string;
  /** The identity `delegate` writes into the delegation record. */
  identity: string;
}

/**
 * Measured 2026-10-25 by asking each host's `getIdentity`, not copied from
 * documentation. `devnet.magicblock.app` with no region is the Asian one.
 */
/**
 * Mainnet runs the SAME three validators under the same identities, on hosts
 * without the `devnet-` prefix: measured 2026-11-04 with getIdentity on
 * us/as/eu.magicblock.app and against the mainnet router's getRoutes. So a
 * PDA seeded by an identity (the presence boards) has the same address on
 * both clusters, and only the host changes with NEXT_PUBLIC_SOLANA_CLUSTER.
 *
 * The mainnet router also lists Tokyo (as-tyo) and Buenos Aires (sa), which
 * devnet has no equivalent of. Adding one means a board for it
 * (presence-setup.ts) and a row here, nothing else.
 */
const HOST = SOLANA_CLUSTER === "mainnet"
  ? { us: "https://us.magicblock.app", as: "https://as.magicblock.app", eu: "https://eu.magicblock.app" }
  : { us: "https://devnet-us.magicblock.app", as: "https://devnet-as.magicblock.app", eu: "https://devnet-eu.magicblock.app" };

export const ER_VALIDATORS: readonly ErValidator[] = [
  { id: "us", label: "US", rpc: HOST.us,
    identity: "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd" },
  { id: "as", label: "Asia", rpc: HOST.as,
    identity: "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57" },
  { id: "eu", label: "Europe", rpc: HOST.eu,
    identity: "MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e" },
];

/**
 * Where the city writes today.
 *
 * Still one validator for everybody: this file makes the READ side able to
 * span all of them, which is the half that can be proven without touching a
 * single delegation. Spreading the writes is the next step and the one that
 * can strand a PDA on the wrong rollup, so it waits for this to be shown
 * working.
 */
export const WRITE_VALIDATOR: ErValidator = ER_VALIDATORS[0];

export interface ProbeResult {
  id: ErValidator["id"];
  /** Round trip in ms, or null when the host did not answer. */
  ms: number | null;
}

let probed: ProbeResult[] | null = null;
let probing: Promise<ProbeResult[]> | null = null;

/**
 * Times one cheap call against every validator, in parallel.
 *
 * `getSlot` rather than anything program-shaped: it is the smallest answer the
 * host can give, so what is measured is the road and not the query. The first
 * call to a host also pays TLS, which is why this is run once and reused
 * rather than sampled during play - a fresh connection per sample measured
 * the handshake and reported three times the real latency.
 */
export async function probeValidators(
  timeoutMs = 4000, opts: { fresh?: boolean } = {},
): Promise<ProbeResult[]> {
  // `fresh` is for the region picker: a player who has just flown somewhere
  // wants today's numbers, not the ones from when the page opened.
  if (probed && !opts.fresh) return probed;
  // One measurement at a time. The constructor starts one in the background
  // and a delegation awaits it; without this the second call started a second
  // probe instead of waiting for the first.
  if (probing) return probing;
  if (typeof fetch === "undefined") return ER_VALIDATORS.map((v) => ({ id: v.id, ms: null }));

  probing = runProbe(timeoutMs);
  try {
    probed = await probing;
  } finally {
    probing = null;
  }
  return probed;
}

function runProbe(timeoutMs: number): Promise<ProbeResult[]> {
  return Promise.all(ER_VALIDATORS.map(async (v): Promise<ProbeResult> => {
    const started = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      // Twice, and the SECOND one is the measurement: the first pays for the
      // TLS handshake, which the game never pays again once it is connected.
      for (let i = 0; i < 2; i++) {
        const at = Date.now();
        const res = await fetch(v.rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }),
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        await res.json();
        if (i === 1) {
          clearTimeout(timer);
          return { id: v.id, ms: Date.now() - at };
        }
      }
      clearTimeout(timer);
      return { id: v.id, ms: Date.now() - started };
    } catch {
      return { id: v.id, ms: null };
    }
  }));
}

/** The last probe, without running one. Empty until `probeValidators` has. */
export function lastProbe(): ProbeResult[] {
  return probed ?? [];
}

/**
 * The closest validator that answered, or the write validator when nothing
 * has been measured yet.
 *
 * Delegations go here unless the player picked a region (see
 * OnChainMultiplayer.switchValidator). Await `probeValidators` first: called
 * before the probe is back, this is the US fallback, not the nearest.
 */
export function nearestValidator(): ErValidator {
  const ranked = lastProbe()
    .filter((p): p is { id: ErValidator["id"]; ms: number } => p.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (ranked.length === 0) return WRITE_VALIDATOR;
  return ER_VALIDATORS.find((v) => v.id === ranked[0].id) ?? WRITE_VALIDATOR;
}

/**
 * How much faster another region has to be before the city suggests moving.
 *
 * Moving ends the delegation, which MagicBlock bills (~0.003 SOL), and costs a
 * wallet approval. So the gap has to be one the player can feel: 100ms is
 * about a third of the distance between continents, well above the jitter
 * between two probes of the same host.
 */
export const REGION_HINT_MIN_GAIN_MS = 100;

export interface RegionAdvice {
  current: ErValidator;
  currentMs: number | null;
  suggested: ErValidator;
  suggestedMs: number;
}

/**
 * A faster region than the one the account is delegated to, or null when the
 * current one is fine (or nothing was measured). An unreachable current
 * region counts as slow: any region that answered beats it.
 */
export function regionAdvice(currentId: ErValidator["id"]): RegionAdvice | null {
  const results = lastProbe();
  const current = ER_VALIDATORS.find((v) => v.id === currentId);
  if (!current || results.length === 0) return null;
  const near = nearestValidator();
  if (near.id === currentId) return null;
  const nearMs = results.find((r) => r.id === near.id)?.ms ?? null;
  if (nearMs === null) return null;
  const currentMs = results.find((r) => r.id === currentId)?.ms ?? null;
  if (currentMs !== null && currentMs - nearMs < REGION_HINT_MIN_GAIN_MS) return null;
  return { current, currentMs, suggested: near, suggestedMs: nearMs };
}
