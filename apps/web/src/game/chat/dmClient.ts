/**
 * Client side of direct messages (/api/dm).
 *
 * Every request is signed with the session key, so DMs never ask the wallet
 * for anything. Polling the inbox is also what marks this player online for
 * senders; it pauses while the tab is hidden.
 */
import nacl from "tweetnacl";
import type { Keypair } from "@solana/web3.js";
import { dmMessage, type DmAction } from "@/lib/dm/dmMessage";

import { DM_SETTINGS_EVENT, DMS_OFF_KEY, DMS_PENDING_KEY, dmsOffPref } from "./dmEvents";
export { OPEN_DM_EVENT, DM_SETTINGS_EVENT, dmsOffPref, setDmsOffPref } from "./dmEvents";

/**
 * Each poll is one paid command, so the inbox is checked often only while the
 * player is actually reading direct messages; otherwise it is a slow heartbeat
 * that brings the unread badge along. Messages wait a day on the server, so
 * nothing is lost by checking rarely.
 */
const POLL_ACTIVE_MS = 10_000;
const POLL_IDLE_MS = 5 * 60_000;
/** After a failed poll (session key not verified yet, store down), wait longer. */
const BACKOFF_MS = 60_000;

export interface IncomingDM {
  from: string;
  text: string;
  at: number;
}

type Result = { ok: true } | { ok: false; message: string };

export class DMClient {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** True while the player has the DM tab open. */
  private active = false;
  private listeners = new Set<(m: IncomingDM) => void>();
  private stopped = false;

  constructor(private wallet: string, private sessionKey: () => Keypair) {}

  start(): void {
    this.stopped = false;
    window.addEventListener(DM_SETTINGS_EVENT, this.onSettings);
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    window.removeEventListener(DM_SETTINGS_EVENT, this.onSettings);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** The chat tells us when direct messages are on screen. */
  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    // Opening the tab: read the inbox now rather than at the next heartbeat.
    if (on && !this.stopped) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      void this.tick();
    }
  }

  onMessage(cb: (m: IncomingDM) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  async send(to: string, text: string): Promise<Result> {
    try {
      const res = await this.post("send", { to, text });
      if (res.ok) return { ok: true };
      return { ok: false, message: res.message ?? "Could not send." };
    } catch {
      return { ok: false, message: "Could not send. Check your connection." };
    }
  }

  private onSettings = () => { void this.syncSettings(); };

  private onVisibility = () => {
    if (document.visibilityState === "visible" && !this.timer && !this.stopped) void this.tick();
  };

  private async tick(): Promise<void> {
    this.timer = null;
    if (this.stopped) return;
    if (document.visibilityState !== "visible") return; // resumes on visibilitychange
    let next = BACKOFF_MS;
    try {
      const res = await this.post("poll");
      if (res.ok) {
        next = this.active ? POLL_ACTIVE_MS : POLL_IDLE_MS;
        // The server is the source of truth (the setting follows the wallet
        // across devices); a change made here but not yet pushed wins.
        let pending = false;
        try { pending = localStorage.getItem(DMS_PENDING_KEY) === "1"; } catch { /* storage blocked */ }
        if (pending) void this.syncSettings();
        else {
          try { localStorage.setItem(DMS_OFF_KEY, res.off ? "1" : "0"); } catch { /* storage blocked */ }
        }
        for (const m of res.messages ?? []) {
          for (const cb of this.listeners) cb(m);
        }
      }
    } catch { /* network blip: try again next tick */ }
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), next);
  }

  private async syncSettings(): Promise<void> {
    const off = dmsOffPref();
    try {
      const res = await this.post("settings", { off });
      if (res.ok) {
        try { localStorage.removeItem(DMS_PENDING_KEY); } catch { /* storage blocked */ }
      }
    } catch { /* retried on the next poll */ }
  }

  private async post(
    action: DmAction,
    extra: { to?: string; text?: string; off?: boolean } = {},
  ): Promise<{ ok: boolean; message?: string; off?: boolean; messages?: IncomingDM[] }> {
    const kp = this.sessionKey();
    const ts = Date.now();
    const msg = new TextEncoder().encode(dmMessage(action, this.wallet, ts, extra));
    const signature = btoa(String.fromCharCode(...nacl.sign.detached(msg, kp.secretKey)));
    const res = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, wallet: this.wallet, sessionKey: kp.publicKey.toBase58(), ts, signature, ...extra }),
    });
    return res.json();
  }
}

/** Nickname or wallet -> wallet. */
export async function resolveRecipient(input: string): Promise<{ wallet: string } | { error: string }> {
  const q = input.trim().replace(/^@/, "");
  if (!q) return { error: "Type a nickname or wallet." };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) return { wallet: q };
  try {
    const res = await fetch(`/api/dm?resolve=${encodeURIComponent(q)}`);
    const body = await res.json();
    if (body.wallet) return { wallet: body.wallet };
    return { error: `No player named ${q}.` };
  } catch {
    return { error: "Could not look that up. Try again." };
  }
}
