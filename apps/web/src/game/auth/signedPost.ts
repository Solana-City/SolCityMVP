/**
 * Client side of the signed writes (/api/quests, /api/events): the session key
 * signs, the server checks it against the wallet's player PDA. The same scheme
 * as the daily check-in and direct messages, so the wallet is never asked.
 *
 * Writes here are fire and forget, so a request the server turned away for a
 * reason that passes is tried again: the session key is authorized on-chain a
 * few seconds AFTER the city loads, and a clock a minute out is corrected from
 * the server's own time (lib/clockSkew.ts). Anything else is dropped.
 */
import nacl from "tweetnacl";
import type { Keypair } from "@solana/web3.js";
import { learnClockSkew, serverNow } from "@/lib/clockSkew";

let signer: (() => Keypair | null) | null = null;

/** The city registers its session key here once the network exists. */
export function setRequestSigner(fn: (() => Keypair | null) | null): void {
  signer = fn;
}

const AUTH_RETRY_MS = 4_000;
const MAX_ATTEMPTS = 6;
const MAX_CORRECTIONS = 2;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * POSTs `fields` plus the signature fields. `message(ts)` builds the exact
 * string the server rebuilds and checks. Resolves with the parsed response
 * body, or null when the request never succeeded.
 */
export async function postSigned(
  url: string,
  wallet: string,
  message: (ts: number) => string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  let corrections = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const kp = signer?.() ?? null;
    if (!kp) {
      // The city has not started yet.
      await wait(AUTH_RETRY_MS);
      continue;
    }
    try {
      const ts = serverNow();
      const sig = nacl.sign.detached(new TextEncoder().encode(message(ts)), kp.secretKey);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...fields, wallet, sessionKey: kp.publicKey.toBase58(), ts,
          signature: btoa(String.fromCharCode(...sig)),
        }),
        keepalive: true,
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (res.ok) return body;
      if (res.status !== 401) return null;
      if (typeof body.serverTs === "number") {
        // Our clock was the problem: correct it and sign again straight away.
        learnClockSkew(body.serverTs);
        if (++corrections <= MAX_CORRECTIONS) { attempt--; continue; }
        return null;
      }
      if (!body.retry) return null; // a refusal that waiting will not change
    } catch { /* network blip: try again */ }
    await wait(AUTH_RETRY_MS);
  }
  return null;
}
