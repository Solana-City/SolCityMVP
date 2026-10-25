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
export const ER_VALIDATORS: readonly ErValidator[] = [
  { id: "us", label: "US", rpc: "https://devnet-us.magicblock.app",
    identity: "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd" },
  { id: "as", label: "Asia", rpc: "https://devnet-as.magicblock.app",
    identity: "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57" },
  { id: "eu", label: "Europe", rpc: "https://devnet-eu.magicblock.app",
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

/**
 * Times one cheap call against every validator, in parallel.
 *
 * `getSlot` rather than anything program-shaped: it is the smallest answer the
 * host can give, so what is measured is the road and not the query. The first
 * call to a host also pays TLS, which is why this is run once and reused
 * rather than sampled during play - a fresh connection per sample measured
 * the handshake and reported three times the real latency.
 */
export async function probeValidators(timeoutMs = 4000): Promise<ProbeResult[]> {
  if (probed) return probed;
  if (typeof fetch === "undefined") return ER_VALIDATORS.map((v) => ({ id: v.id, ms: null }));

  probed = await Promise.all(ER_VALIDATORS.map(async (v): Promise<ProbeResult> => {
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
  return probed;
}

/** The last probe, without running one. Empty until `probeValidators` has. */
export function lastProbe(): ProbeResult[] {
  return probed ?? [];
}

/**
 * The closest validator that answered, or the write validator when nothing
 * has been measured yet.
 *
 * Nothing delegates by this yet. It exists so the measurement can be taken and
 * looked at before anybody's PDA is moved anywhere.
 */
export function nearestValidator(): ErValidator {
  const ranked = lastProbe()
    .filter((p): p is { id: ErValidator["id"]; ms: number } => p.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (ranked.length === 0) return WRITE_VALIDATOR;
  return ER_VALIDATORS.find((v) => v.id === ranked[0].id) ?? WRITE_VALIDATOR;
}
