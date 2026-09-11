/**
 * Sol Mechs PvP — local test transport.
 *
 * Two tabs of the same browser find each other over a BroadcastChannel and
 * play with the same commit–reveal steps as the chain transport. No wallet,
 * no network. It exists so the whole PvP flow can be exercised before the
 * program is deployed, and so a desync can be reproduced offline.
 *
 * Pairing is a three-message handshake — offer, accept, confirm — because a
 * plain "first to answer" would let a tab with two seekers in view pair with
 * both. Only the lower id offers, and a tab with a handshake outstanding
 * ignores every other one until it settles or times out.
 */
import type { TeamBuild } from "../data/team";
import { decodeTeam, encodeTeam, matchSeed } from "./protocol";
import {
  OpponentGoneError, abortError,
  type MatchInfo, type OpponentReveal, type PvpTransport, type SearchPhase,
} from "./types";

const CHANNEL = "solmechs-pvp-v1";
const SEEK_MS = 800;
const HANDSHAKE_MS = 2_500;
const PING_MS = 2_000;
/**
 * Silence after which the other tab is treated as closed.
 *
 * Generous on purpose. In a two-tab test one tab is always in the background,
 * and browsers throttle background timers — down to once a minute after a few
 * minutes hidden — so its pings can legitimately stall. A real close is caught
 * straight away by the `leave` sent on pagehide; this only covers a crash.
 */
const GONE_MS = 90_000;
/** Searching this long without hearing any other tab shows NO_PEER_HINT. */
const NO_PEER_HINT_MS = 5_000;
const NO_PEER_HINT =
  "No other tab has answered. Open the second tab in this same browser window and press FIND MATCH "
  + "there too — a private window, another browser, the app preview, or 127.0.0.1 instead of "
  + "localhost cannot see this one.";

type Msg =
  | { t: "seek"; from: string }
  | { t: "offer"; from: string; to: string; name: string; team: number[]; matchId: string }
  | { t: "accept"; from: string; to: string; name: string; team: number[]; matchId: string }
  | { t: "confirm"; from: string; to: string; matchId: string }
  | { t: "commit"; from: string; matchId: string; step: number; commitment: number[] }
  | { t: "reveal"; from: string; matchId: string; step: number; action: number[]; salt: number[]; check: number }
  | { t: "ping"; from: string; matchId: string }
  | { t: "leave"; from: string; matchId: string };

interface Search {
  team: TeamBuild;
  resolve: (match: MatchInfo) => void;
  offer: { to: string; matchId: string; at: number } | null;
  accepted: { from: string; matchId: string; name: string; team: number[]; at: number } | null;
}

interface LiveMatch {
  id: bigint;
  key: string;
  opponent: string;
  lastHeard: number;
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class LocalTransport implements PvpTransport {
  readonly kind = "local" as const;
  readonly label = "Local test · open this page in a second tab";

  private readonly id = randomHex(8);
  private readonly name: string;
  private readonly channel: BroadcastChannel;
  private search: Search | null = null;
  private match: LiveMatch | null = null;
  private readonly commits = new Map<number, Uint8Array>();
  private readonly reveals = new Map<number, OpponentReveal>();
  private readonly waiters = new Set<() => void>();
  private readonly goneListeners = new Set<() => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  /** Last time any other tab was heard on the channel, for NO_PEER_HINT. */
  private lastPeerAt = 0;

  constructor(name?: string) {
    this.name = name ?? `Tab ${this.id.slice(0, 4).toUpperCase()}`;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (e: MessageEvent) => this.onMessage(e.data as Msg);
    if (typeof window !== "undefined") window.addEventListener("pagehide", this.onPageHide);
  }

  findMatch(
    team: TeamBuild,
    onStatus: (phase: SearchPhase, detail?: string) => void,
    signal: AbortSignal,
  ): Promise<MatchInfo> {
    if (this.match) void this.leave();
    onStatus("searching");
    return new Promise<MatchInfo>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      // BroadcastChannel only reaches tabs that share this origin AND this
      // browser's storage. A tab anywhere else never hears us, so after a few
      // silent seconds the lobby says so instead of spinning forever.
      const startedAt = Date.now();
      let hinting = false;
      const seek = () => {
        this.post({ t: "seek", from: this.id });
        const now = Date.now();
        const alone = now - startedAt > NO_PEER_HINT_MS && now - this.lastPeerAt > NO_PEER_HINT_MS;
        if (alone !== hinting) {
          hinting = alone;
          onStatus("searching", alone ? NO_PEER_HINT : undefined);
        }
      };
      const timer = setInterval(seek, SEEK_MS);
      const finish = () => {
        clearInterval(timer);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        finish();
        this.search = null;
        reject(abortError());
      };
      this.search = {
        team, offer: null, accepted: null,
        resolve: (m) => { finish(); resolve(m); },
      };
      signal.addEventListener("abort", onAbort, { once: true });
      seek();
    });
  }

  async commit(step: number, commitment: Uint8Array): Promise<void> {
    const m = this.requireMatch();
    this.post({ t: "commit", from: this.id, matchId: m.key, step, commitment: Array.from(commitment) });
  }

  awaitOpponentCommit(step: number, signal: AbortSignal): Promise<Uint8Array> {
    return this.waitFor(() => this.commits.get(step), signal);
  }

  async reveal(step: number, action: Uint8Array, salt: Uint8Array, check: number): Promise<void> {
    const m = this.requireMatch();
    this.post({
      t: "reveal", from: this.id, matchId: m.key, step,
      action: Array.from(action), salt: Array.from(salt), check,
    });
  }

  awaitOpponentReveal(step: number, signal: AbortSignal): Promise<OpponentReveal> {
    return this.waitFor(() => this.reveals.get(step), signal);
  }

  onOpponentGone(cb: () => void): () => void {
    this.goneListeners.add(cb);
    return () => { this.goneListeners.delete(cb); };
  }

  async leave(): Promise<void> {
    const m = this.match;
    this.search = null;
    if (m) this.post({ t: "leave", from: this.id, matchId: m.key });
    this.match = null;
    this.stopPing();
    this.notify();
  }

  dispose(): void {
    if (this.disposed) return;
    void this.leave();
    this.disposed = true;
    this.goneListeners.clear();
    this.channel.close();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.onPageHide);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private onMessage(msg: Msg): void {
    if (this.disposed || msg.from === this.id) return;
    const now = Date.now();
    this.lastPeerAt = now;
    const s = this.search;

    switch (msg.t) {
      case "seek": {
        if (!s || this.id > msg.from) return;
        if (s.offer && now - s.offer.at < HANDSHAKE_MS) return;
        if (s.accepted && now - s.accepted.at < HANDSHAKE_MS) return;
        const matchId = BigInt(`0x${randomHex(6)}`).toString();
        s.offer = { to: msg.from, matchId, at: now };
        this.post({
          t: "offer", from: this.id, to: msg.from,
          name: this.name, team: Array.from(encodeTeam(s.team)), matchId,
        });
        return;
      }
      case "offer": {
        if (!s || msg.to !== this.id) return;
        if (s.offer && now - s.offer.at < HANDSHAKE_MS) return;
        if (s.accepted && now - s.accepted.at < HANDSHAKE_MS) return;
        s.accepted = { from: msg.from, matchId: msg.matchId, name: msg.name, team: msg.team, at: now };
        this.post({
          t: "accept", from: this.id, to: msg.from,
          name: this.name, team: Array.from(encodeTeam(s.team)), matchId: msg.matchId,
        });
        return;
      }
      case "accept": {
        if (!s || msg.to !== this.id || !s.offer) return;
        if (s.offer.to !== msg.from || s.offer.matchId !== msg.matchId) return;
        if (this.begin(s, "host", msg.matchId, msg.from, msg.name, msg.team)) {
          this.post({ t: "confirm", from: this.id, to: msg.from, matchId: msg.matchId });
        }
        return;
      }
      case "confirm": {
        if (!s || msg.to !== this.id || !s.accepted) return;
        if (s.accepted.from !== msg.from || s.accepted.matchId !== msg.matchId) return;
        const a = s.accepted;
        this.begin(s, "guest", a.matchId, a.from, a.name, a.team);
        return;
      }
      default: {
        const m = this.match;
        if (!m || msg.matchId !== m.key || msg.from !== m.opponent) return;
        m.lastHeard = now;
        if (msg.t === "leave") {
          this.opponentGone();
          return;
        }
        if (msg.t === "commit") {
          this.commits.set(msg.step, Uint8Array.from(msg.commitment));
        } else if (msg.t === "reveal") {
          this.reveals.set(msg.step, {
            action: Uint8Array.from(msg.action),
            salt: Uint8Array.from(msg.salt),
            check: msg.check,
          });
        }
        this.notify();
      }
    }
  }

  private begin(
    s: Search,
    role: "host" | "guest",
    key: string,
    opponent: string,
    opponentName: string,
    opponentTeam: number[],
  ): boolean {
    let team: TeamBuild;
    try {
      team = decodeTeam(Uint8Array.from(opponentTeam));
    } catch {
      return false;
    }
    const id = BigInt(key);
    this.search = null;
    this.match = { id, key, opponent, lastHeard: Date.now() };
    this.commits.clear();
    this.reveals.clear();
    this.startPing();
    s.resolve({
      matchId: id,
      role,
      seed: matchSeed(id),
      me: { id: this.id, name: this.name, team: s.team },
      opponent: { id: opponent, name: opponentName, team },
    });
    return true;
  }

  private waitFor<T>(get: () => T | undefined, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        this.waiters.delete(check);
        signal.removeEventListener("abort", check);
      };
      const check = () => {
        if (signal.aborted) {
          cleanup();
          reject(abortError());
          return;
        }
        const value = get();
        if (value !== undefined) {
          cleanup();
          resolve(value);
          return;
        }
        if (!this.match) {
          cleanup();
          reject(new OpponentGoneError());
        }
      };
      this.waiters.add(check);
      signal.addEventListener("abort", check);
      check();
    });
  }

  private notify(): void {
    for (const check of [...this.waiters]) check();
  }

  private requireMatch(): LiveMatch {
    if (!this.match) throw new OpponentGoneError();
    return this.match;
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      const m = this.match;
      if (!m) return;
      this.post({ t: "ping", from: this.id, matchId: m.key });
      if (Date.now() - m.lastHeard > GONE_MS) this.opponentGone();
    }, PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private opponentGone(): void {
    if (!this.match) return;
    this.match = null;
    this.stopPing();
    for (const cb of [...this.goneListeners]) cb();
    this.notify();
  }

  private readonly onPageHide = () => {
    const m = this.match;
    if (m) this.post({ t: "leave", from: this.id, matchId: m.key });
  };

  private post(msg: Msg): void {
    if (!this.disposed) this.channel.postMessage(msg);
  }
}
