import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { BALL_TAG, decodeBallKick, encodeBallKick, type BallKick } from "../world/BeachBall";

// Solana Memo program — same address on mainnet and devnet
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
// Memo data prefixes for the cross-device (cross-wallet) presence channel.
// Position rides the ER; these low-frequency signals ride Solana Memo + onLogs
// (session-key signed = seamless), the same transport chat already uses, so
// players on different devices see each other's outfit and reactions.
const CHAT_PREFIX = "solcity-chat:";
const LOOK_PREFIX = "solcity-look:"; // solcity-look:<wallet>:<k=v|k=v...>
const EXPR_PREFIX = "solcity-expr:"; // solcity-expr:<wallet>:<textureKey>

// Loadout is encoded pipe/eq (NO quotes) — matches the on-chain PlayerState
// `loadout` String, capped at #[max_len(120)]. Category KEYS are abbreviated to
// one char so a FULL outfit (all 8 layers, incl. hat/accessory/back) fits under
// 120 — otherwise the last-encoded layer (hat) was truncated, which is exactly
// why remote players showed up without their hats. Decode accepts both the
// short keys and the old full-word keys so pre-existing loadouts still render.
const LOADOUT_KEY_ABBR: Record<string, string> = {
  skin: "s", hair: "h", eyesFace: "e", tshirt: "t",
  pants: "p", hat: "H", accessory: "a", back: "b",
  // Not a layer: the hair swatch (game/config/hairPalette.ts). Omitted
  // entirely when the style is worn in the colour it was drawn in, which is
  // the common case, so the usual loadout does not get longer.
  hairColor: "c",
};
const LOADOUT_ABBR_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(LOADOUT_KEY_ABBR).map(([full, abbr]) => [abbr, full]),
);
/**
 * Fixed emit order, hair colour LAST.
 *
 * The program caps this at 120 bytes with cap_bytes, which truncates the END,
 * and a full 8-layer outfit already runs over that (see HAIR_COLOR_SPEC.md,
 * "Known issue"). Object key order used to decide what fell off the cliff.
 * Pinning the order makes the colour the first casualty instead of a layer:
 * losing it renders the style as drawn, where losing the hat renders no hat.
 */
const LOADOUT_EMIT_ORDER: (keyof Loadout)[] = [
  "skin", "eyesFace", "pants", "tshirt", "back", "accessory", "hair", "hat", "hairColor",
];

/**
 * Send the loadout as catalog indices rather than variant ids.
 *
 * The switch for `WARDROBE_ONCHAIN.md` phase 2. Reading both formats shipped
 * first and on its own, so that by the time this is turned on every client has
 * long been able to understand the result. Turning it on is one line here; it
 * waits on something granting booster unlocks on chain, because the program
 * rejects the whole outfit of a player wearing an item their snapshot does not
 * hold.
 */
const LOADOUT_AS_INDICES = false;

function encodeLoadout(l: Loadout): string {
  const out: string[] = [];
  for (const k of LOADOUT_EMIT_ORDER) {
    const v = l[k];
    if (!v) continue;
    // The swatch goes as its palette index: "c=13" rather than "c=chestnut" is
    // six bytes that would otherwise push a layer past the cap.
    if (k === "hairColor") {
      const i = hairColorIndex(v);
      if (i >= 0) out.push(`c=${i}`);
      continue;
    }
    // The catalog index, not the variant id, once LOADOUT_AS_INDICES is on.
    //
    // This is what makes wardrobe enforcement possible at all: the program
    // parses every value as a u16 and skips what it cannot parse, so while
    // ids go over the wire it checks nothing. Indices are also shorter, which
    // buys room against the 120-byte cap.
    //
    // STILL OFF, and the old reason has expired. Grants DO exist on chain
    // (open_booster, proven end to end with real USDC), TEST_UNLOCK_ALL_HATS
    // is false, globalIndexOf is built and round-trip tested, and the
    // wardrobe now reads what a wallet owns off the chain. What remains is
    // narrower and sharper:
    //
    // The program checks `player.unlocked`, the SNAPSHOT, not UnlockState.
    // `sync_unlocks` is what copies one to the other, and it can only run
    // while BOTH accounts are writable in the same place. They never are
    // during a session: the player PDA is delegated to the rollup and
    // UnlockState is base-only and never delegated. So a pack bought MID
    // SESSION lands in UnlockState, the client can see it, and the snapshot
    // the program enforces against does not have it until the next connect.
    //
    // Turn this on today and that player's whole outfit write is rejected,
    // freezing them in their last synced look for everyone else, with no clue
    // why. The fix is a grant the rollup can see, which is a program change,
    // so this rides the next deploy rather than a flag. See WARDROBE_ONCHAIN.md.
    const index = LOADOUT_AS_INDICES ? globalIndexOf(k as LayerCategory, v) : -1;
    out.push(`${LOADOUT_KEY_ABBR[k] ?? k}=${index >= 0 ? index : v}`);
  }
  return out.join("|");
}
function decodeLoadout(s: string): Loadout {
  const out: Loadout = {};
  for (const part of s.split("|")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const rawK = part.slice(0, i), v = part.slice(i + 1);
    const k = LOADOUT_ABBR_KEY[rawK] ?? rawK; // short key → full; full stays full
    if (!k || !v) continue;
    if (k === "hairColor") {
      // Numeric is what we send. A swatch id is accepted too: it is what the
      // first build to carry colour broadcast, and a peer may still be on it.
      const byIndex = /^\d+$/.test(v) ? hairColorAtIndex(Number(v)) : v;
      if (byIndex) out.hairColor = byIndex;
      continue;
    }
    // An index as well as an id, the same way hairColor above takes both.
    //
    // The wire is moving from variant ids ("h=Afro") to catalog indices
    // ("h=194"), because the program parses every value as a u16 and can only
    // enforce what it can read. Both are understood here for as long as it
    // takes every client to update: a service worker can keep an old build
    // alive for days, and a peer that cannot read the new format renders a
    // bald, naked avatar rather than a person.
    //
    // No ambiguity to resolve: no variant id is all digits.
    const asIndex = /^\d+$/.test(v) ? itemAtGlobalIndex(Number(v)) : undefined;
    (out as Record<string, string>)[k] = asIndex ? asIndex.variant.id : v;
  }
  // A peer on an older build still broadcasts Brown_hair or a coloured Magawk,
  // which are no longer wardrobe entries. Without this they render as no hair
  // at all, so the rewrite happens on the way in, not just on our own save.
  return migrateHairColor(out);
}
import {
  ConnectionMagicRouter,
  delegationRecordPdaFromDelegatedAccount,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SessionKeyManager } from "../solana/sessionKeys";
import {
  buildInitializePlayerIx,
  buildAuthorizeSessionIx,
  buildDelegateIx,
  buildCommitAndUndelegatePlayerSessionIx,
  buildInitUnlockStateIx,
  buildSyncUnlocksIx,
  buildUpdatePositionSessionIx,
  buildUpdateLookSessionIx,
  buildSetExpressionSessionIx,
  buildPublishProfileSessionIx,
  buildSendChatSessionIx,
  buildRecordSwapIx,
  buildRecordTransferIx,
  buildRecordBountyIx,
  buildRecordMiniGameSessionIx,
  buildRecordGameScoreSessionIx,
  buildInitializeHuntIx,
  buildClaimFindIx,
  isProgramDeployed,
} from "../solana/instructions";
import {
  derivePlayerPDA, SOL_CITY_PROGRAM_ID, deriveHuntPDA, decodeHuntState,
  deriveUnlockPDA,
  achievementIndices, ACHIEVEMENT_BITS,
} from "../solana/program";
import { BASE_RPC_PRIMARY, resilientBaseFetch } from "../solana/baseRpc";
import { setHuntFromChain, clearHuntFromChain } from "../minigames/whereIsNPC/WhereIsNPCGame";
import { transactionLog } from "../telemetry/transactionLog";
import { migrateHairColor, type Loadout } from "../config/paperDoll";
import { hairColorAtIndex, hairColorIndex } from "../config/hairPalette";
import { ER_VALIDATORS, probeValidators, nearestValidator } from "./erValidators";
import { globalIndexOf, itemAtGlobalIndex } from "@/game/config/catalogIndex";
import { setOnChainUnlocks } from "@/game/config/wardrobeUnlocks";
import { gameSlotOf, GAME_SLOT_CAP } from "@/game/minigames/slots";
import type { LayerCategory } from "@/game/config/paperDoll";

// ── Endpoints ──────────────────────────────────────────────────────────

const ENDPOINTS = {
  magicRouter:  "https://devnet-router.magicblock.app",
  // US, chosen 2026-10-22. Verified 2026-10-25: this host answers getIdentity
  // with MUS3hc9…, and the old devnet.magicblock.app answers MAS1Dt9… (Asia).
  ephemeral:    "https://devnet-us.magicblock.app",
  solanaDevnet: "https://api.devnet.solana.com",
} as const;

/**
 * The city used to name one rollup here and send everybody to it.
 *
 * That constant is gone: `erValidators.ts` holds all three, with identities
 * read from each host's own `getIdentity`, and a player now delegates to the
 * nearest one. Keeping a second copy of a validator key in this file is how
 * the two would quietly stop agreeing.
 *
 * What is left here is only the DEFAULT read/write target, used until the
 * sweep has found where this wallet's PDA actually lives.
 */

/**
 * Bytes of a PlayerState this client actually reads: through game_bests, with
 * every variable-length string at its maximum.
 *
 * 8 discriminator + 32 authority + 33 session + 24 name + 4 x + 4 y + 1 dir
 * + 1 outfit + 4 score + 2+2+2 counts + 8 last_active + 8 created_at
 * + 124 loadout + 28 expression + 8 expression_at + 204 message + 8 message_at
 * + 32 achievements + 2 + 2 streaks + 64 game_bests = 605.
 *
 * The 514-byte unlock snapshot sits after this and is never fetched.
 */
const PLAYER_READ_BYTES = 605;

// What a CURRENT-layout account must return from the sliced sweep.
//
// Discovery has to ignore STALE PDAs from older seeds, still delegated on the
// rollup, which would otherwise overwrite the live player and strand that
// wallet at a frozen position. v1 is ~133 bytes and v2 ~505; a v3 account is
// larger than the slice, so it always comes back at exactly PLAYER_READ_BYTES
// while anything older is clamped to its own smaller size.
//
// So the test is equality with the slice, not a threshold between two layouts.
// The old 256 sat between v1 and v2 and would now let a v2 ghost through.
const CURRENT_PLAYER_MIN_LEN = PLAYER_READ_BYTES;

/**
 * What the discovery sweep asks every rollup for.
 *
 * Everything the decoder reads and nothing after it. The unlock snapshot sits
 * at the end of every PlayerState and the sweep runs for every online player
 * every few seconds, so leaving it on the server is the whole reason that
 * field was moved down there.
 *
 * A FIXED length rather than a computed offset, because the strings in the
 * middle are variable: Borsh writes their real length, so the position of any
 * later field differs per account. PLAYER_READ_BYTES is the WORST case, every
 * string at its max, which is the only length guaranteed to contain the
 * fields whatever the account holds.
 */
const SWEEP_CONFIG = {
  commitment: "confirmed" as const,
  dataSlice: { offset: 0, length: PLAYER_READ_BYTES },
};

/**
 * `last_active` off a sliced PlayerState, for picking the fresher of two
 * copies of the same PDA. Only the low 32 bits, which is all the decoder
 * reads and is good until 2106.
 */
function lastActiveOf(data: Uint8Array): number {
  // Walked, not computed from a constant, because two fields before it are
  // variable length and a fixed offset reads neither of them.
  //
  // `session_authority` is an Option: one tag byte, and the 32 only when it
  // is Some. `display_name` is a Borsh String: a 4-byte length and then THAT
  // MANY bytes, not the 20 of its max_len. A constant offset assumed the
  // worst case for both and so pointed into the middle of whatever came next.
  //
  // This matters more than it looks. The sweep merges the copies every rollup
  // holds of the same account and keeps the one with the newest last_active,
  // since only the rollup holding the delegation ever updates it. Reading
  // that field wrong made the choice a coin toss, so a player could be
  // resolved to a stale copy, drop out of the freshness gate, and vanish for
  // one side of the city while still seeing the other. One-way visibility.
  try {
    const d = Buffer.from(data);
    let o = 8 + 32;                               // discriminator, authority
    o += 1 + (d[o] ? 32 : 0);                     // Option<Pubkey>
    if (o + 4 > d.length) return 0;
    o += 4 + d.readUInt32LE(o);                   // String, length-prefixed
    o += 4 + 4 + 1 + 1 + 4 + 2 + 2 + 2;           // x y dir outfit score counts
    if (o + 4 > d.length) return 0;
    // The low 32 bits of the i64, which is all a comparison needs and is good
    // until 2106.
    return d.readUInt32LE(o);
  } catch {
    return 0;
  }
}

// Shared state channel name — BroadcastChannel works across tabs
// in the same browser origin. Provides instant multi-tab multiplayer
// without any server, perfect for live demo.
const BROADCAST_CHANNEL = "sol-city-v1";

// BroadcastChannel message types
type BCMsg =
  | { t: "join";  w: string; x: number; y: number; d: number; m: boolean; name?: string; score?: number; l?: Loadout }
  | { t: "pos";   w: string; x: number; y: number; d: number; m: boolean; b?: number | null }
  | { t: "chat";  w: string; text: string }
  | { t: "look";  w: string; l: Loadout }
  | { t: "expr";  w: string; e: string }
  | { t: "ball";  w: string; k: BallKick }
  | { t: "leave"; w: string };

// Throttle position broadcasts. Every other screen can only be as current as
// the last sample, so this interval is a floor under the delay players see.
// 200ms is ~5 tx/s per walking player: rollup transactions carry no fee, and
// the rate limits that bit us were on READS (polls), which this does not touch.
const POS_THROTTLE_MS = 200;

// The on-chain direction byte is a plain u8 the program never validates, and
// only values 0-3 are directions. Two spare bits carry what receivers need to
// predict motion: whether the sender is walking, and a marker that says this
// sender sets that bit at all (so an older client's 0 is not read as "stopped").
const DIR_MASK = 0b0011;
const DIR_WALKING = 0b0100;
const DIR_HAS_WALK_FLAG = 0b1000;
// A third spare bit: this sender is carrying a speed buff. Receivers draw the
// badge over their head, so a player who is suddenly quicker reads as buffed
// rather than as a desynced avatar. Older clients mask it off with DIR_MASK.
const DIR_SPEED_BUFF = 0b1_0000;
// Which drink, so the watcher draws the right cup rather than a generic one:
// the index of the buff in BUFF_ORDER, one bit wide, which covers the two
// that exist. A third would take the next bit up, 0b100_0000.
const DIR_BUFF_KIND = 0b10_0000;
const packDirection = (dir: number, walking: boolean, buffIndex: number | null): number =>
  (dir & DIR_MASK) | (walking ? DIR_WALKING : 0) | DIR_HAS_WALK_FLAG
  | (buffIndex === null ? 0 : DIR_SPEED_BUFF | ((buffIndex & 1) ? DIR_BUFF_KIND : 0));
// Floor for the leading-edge sends (turns and stops). Short enough that a
// corner reads as instant, long enough that it can't become a tx firehose.
const POS_EVENT_MIN_MS = 150;
// Module-level, not rebuilt per call: sendInput runs on every scene frame and
// used to allocate this map before its own early return, so a standing player
// still handed the collector ~60 short-lived objects a second.
const DIR_NUM: Record<string, number> = { down: 0, left: 1, right: 2, up: 3 };
// Re-write the current position after this long without any on-chain write,
// so a standing player stays inside everyone else's freshness window.
const HEARTBEAT_MS = 30_000;
// After this many consecutive position writes that never reached the network,
// the player is effectively invisible to the city and is told so.
const OFFLINE_AFTER_FAILURES = 5;

// ── Types ──────────────────────────────────────────────────────────────

export interface OnChainPlayer {
  wallet: string;
  x: number;
  y: number;
  direction: number;
  isWalking: boolean;
  /**
   * The sender's own "walking" flag, when it sends one (see DIR_WALKING).
   * Undefined for clients that predate it — then only isWalking, inferred
   * from position changes, is known.
   */
  walkFlag?: boolean;
  /**
   * Which buff this player is carrying, as an index into BUFF_ORDER, or null
   * for none. Undefined from a client that predates the flag.
   */
  buffIndex?: number | null;
  lastUpdate: number;
  displayName?: string;
  score?: number;
  loadout?: Loadout;
  // -- The public profile, for the card another player opens on you ---------
  /** Achievement registry indices this player has published. */
  achievements?: Set<number>;
  /** Daily check-in streak, as the player last published it. */
  streakCurrent?: number;
  streakBest?: number;
  /**
   * Best score per mini-game, indexed by slot (game/minigames/slots.ts).
   *
   * Read off the same sweep as everything else, so a board costs no extra
   * RPC: the account is already in hand and these are the last bytes before
   * the unlock snapshot.
   */
  gameBests?: number[];
}

type PlayerCallback  = (wallet: string, player: OnChainPlayer) => void;
type RemoveCallback  = (wallet: string) => void;
type ExprCallback    = (wallet: string, textureKey: string) => void;

// ── OnChainMultiplayer ─────────────────────────────────────────────────

/**
 * Multiplayer via two complementary layers:
 *
 *  Layer 1 — BroadcastChannel (always active)
 *    Cross-tab multiplayer within the same browser session.
 *    Zero infrastructure. Works immediately on any machine.
 *    Perfect for live demo with multiple browser tabs.
 *
 *  Layer 2 — MagicBlock Ephemeral Rollup (activates when program deployed)
 *    Real cross-browser, cross-device multiplayer.
 *    Position updates sent as transactions through Magic Router.
 *    Other clients subscribe via `accountSubscribe` on the ephemeral RPC.
 *    Discovery via `getProgramAccounts` on the ephemeral validator.
 *
 * Both layers share the same callbacks — CityScene doesn't distinguish.
 */
/**
 * Outcome of a `claim_find`. `won` is the only thing that scores, but the
 * caller also needs `roundMoved`: a claim that lost to another player means the
 * citizen is genuinely gone, while a claim that never landed means the citizen
 * is still out there and the find has to be given back.
 */
/** What a hunt write did, so a failure can say why instead of vanishing. */
interface HuntSend {
  signature: string | null;
  error: string | null;
}

export interface ClaimResult {
  won: boolean;
  roundMoved: boolean;
}

export class OnChainMultiplayer {
  // Connections
  private routerConnection:    ConnectionMagicRouter;
  private ephemeralConnection: Connection;
  /**
   * One read connection per rollup, so the city can be spread across them.
   *
   * Writes still all go to `ephemeralConnection`. This is the READ half,
   * which is the half that can be proven without touching a delegation: if
   * everybody still sees everybody with three endpoints being swept, then
   * spreading the writes later is safe. If it breaks, nobody's PDA has moved.
   */
  private erReadConnections: { id: string; conn: Connection }[] = [];
  /**
   * Which rollup each player's PDA was last seen on, as an index into
   * `erReadConnections`.
   *
   * A delegated account exists on exactly one rollup and is invisible on the
   * others, so the position poll has to ask the right one. Filled by the
   * discovery sweep, which is the only thing that looks everywhere.
   */
  private playerRollup = new Map<string, number>();
  private baseConnection:      Connection;

  // Session
  private sessionKeys: SessionKeyManager;
  private wallet:    PublicKey | null = null;
  private _connected = false;

  // Player registry (local)
  private knownPlayers = new Map<string, OnChainPlayer>();

  // Callbacks wired by CityScene
  private addCallbacks:    PlayerCallback[] = [];
  private removeCallbacks: RemoveCallback[] = [];
  private changeCallbacks: PlayerCallback[] = [];
  private exprCallbacks:   ExprCallback[]   = [];

  // Local player's current paper-doll loadout, broadcast so others render the
  // real look instead of a placeholder. Debounced so wardrobe live-preview
  // churn doesn't spam the channel.
  private localLoadout: Loadout | undefined;
  private lookDebounce: ReturnType<typeof setTimeout> | null = null;
  // Looks that arrived (via memo) before we'd discovered that player — applied
  // once their avatar exists.
  private pendingLoadouts = new Map<string, Loadout>();
  // Coalesces "re-announce my look" when new players appear (cross-device).
  private lookRebroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  // Rate-limits expression memos so the base layer isn't spammed.
  private lastExprMemoAt = 0;

  // Throttling
  private lastPosSent = 0;
  private lastPos = { x: 0, y: 0, direction: 0, isWalking: false, buffIndex: null as number | null };
  /** When the last position write was handed to the network (heartbeat clock). */
  private lastChainSendAt = 0;
  private moveFailStreak = 0;
  /** Last value published on "multiplayer:online" — only changes are emitted. */
  private onlineFlag: boolean | null = null;
  /** Display name kept from connect(), so a retry can re-run the setup. */
  private displayName: string | undefined;
  private retrying = false;
  /**
   * wallet → rollup slot of the newest state applied for them. Positions
   * arrive over two paths (websocket push, poll) that can land out of order;
   * last_active only has one-second resolution, so without the slot an older
   * sample could win and pull the avatar backwards before the newer one
   * pushed it forward again — the slide-freeze-jump players saw.
   */
  private lastSlot = new Map<string, number>();
  /**
   * Last bytes the discovery sweep saw for each PDA, so an account that has
   * not changed since the previous sweep is not parsed again. Keyed by PDA
   * because that is all the sweep knows before decoding. Bounded by the
   * number of accounts ever delegated, a few hundred bytes each.
   */
  private lastDiscoveryBytes = new Map<string, Buffer>();
  /** Changed states applied per source since the last [mp] log line. */
  private readsByPush = 0;
  private readsByPoll = 0;
  // ── Device clock vs chain clock ───────────────────────────────────────
  // The freshness gate compares an on-chain timestamp against Date.now(), so
  // a device whose clock is a few minutes fast judges EVERY live player as
  // idle and lands in an empty city. We learn the offset instead of trusting
  // the device: when a player's last_active increases, we just watched that
  // write happen, so chain time and device time are the same instant.
  /** wallet → last_active (unix seconds) at the previous sighting. */
  private lastSeenTs = new Map<string, number>();
  private clockSkewMs = 0;       // device clock minus chain clock
  private moveRttMs = 0;         // smoothed send -> accepted, for the renderer
  /** Moves that cost more than one round trip, since the last report. */
  private moveCost = { retries: 0, coldHash: 0, total: 0 };

  /**
   * Notes a move that cost more than the one round trip it should.
   *
   * Reported rather than fixed, because the two causes want different fixes
   * and guessing between them from a latency number is how the wrong one gets
   * built. A cold blockhash means the prefetch is not keeping up; a retry
   * means the send itself was rejected.
   */
  private noteMoveCost(attempt: number, coldHash: boolean): void {
    if (attempt > 0) this.moveCost.retries++;
    if (coldHash) this.moveCost.coldHash++;
  }

  /**
   * How long a position write takes to be accepted, smoothed. Zero until the
   * first one lands.
   *
   * The remote-player predictor needs to know how stale the position it is
   * drawing already is, and that number moved when the city moved validator:
   * the same two machines side by side went from ~130ms to ~300ms, because
   * every update travels to the rollup and back out. Hard-coding it meant the
   * predictor was tuned for one region and read as sliding everywhere else.
   */
  getMoveRttMs(): number {
    return this.moveRttMs;
  }

  /**
   * Unix SECONDS on the chain's clock.
   *
   * The hunt derives which citizen is the target from a timestamp, so every
   * client has to agree on what time it is. A device an hour fast would hunt
   * a citizen nobody else is hunting and have its claim rejected for naming
   * the wrong round.
   */
  private chainNowSecs(): number {
    return Math.floor((Date.now() - this.clockSkewMs) / 1000);
  }

  // Local player score (kept in sync by CityScene via updateScore())
  private localScore = 0;

  // Layer 1: BroadcastChannel
  private bc: BroadcastChannel | null = null;

  // Layer 2: MagicBlock subscriptions
  private accountSubs = new Map<string, number>(); // wallet → subscriptionId
  /** true = use ephemeral rollup; false = fall back to base layer devnet */
  private useEphemeral = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  /** Poll/discovery timers — cleared on disconnect so they don't stack across reconnects. */
  private discoveryTimers: ReturnType<typeof setInterval>[] = [];
  /** Program-wide subscription — removed on disconnect. The wallet adapter
   *  can cycle connect/disconnect rapidly; leaking one subscription per cycle
   *  is what trips devnet's connection-level rate limit ("Connection rate
   *  limits exceeded"). Never assigned today: the Magic Router does not
   *  support onProgramAccountChange, so the ER poll carries reads instead. */
  private programSubId: number | null = null;

  constructor() {
    this.routerConnection    = new ConnectionMagicRouter(ENDPOINTS.magicRouter,  "confirmed");
    this.ephemeralConnection = new Connection(ENDPOINTS.ephemeral,    "confirmed");
    // Measure the three once, in the background. Nothing delegates by this
    // yet: it is the number the validator question was missing, and it has to
    // exist before anybody's PDA is moved anywhere.
    void probeValidators().then((results) => {
      const line = results
        .map((r) => `${r.id}:${r.ms === null ? "unreachable" : r.ms + "ms"}`)
        .join("  ");
      const near = nearestValidator();
      console.log(`[Multiplayer] rollup latency  ${line}  -> nearest ${near.label}`);
    }).catch(() => undefined);

    this.erReadConnections = ER_VALIDATORS.map((v) => ({
      id: v.id,
      // The write validator reuses the connection the writes are already on,
      // so the common case opens no extra socket.
      conn: v.rpc === ENDPOINTS.ephemeral
        ? this.ephemeralConnection
        : new Connection(v.rpc, "confirmed"),
    }));
    // Base HTTP ops (getAccountInfo / getBalance / blockhash / sendRawTransaction
    // / confirm) go through a failover fetch across Helius devnet + api.devnet.
    // NOT the Magic Router — it HANGS on sendRawTransaction (routing proxy, not
    // a full RPC), which is what made every base write "rpc timeout". See
    // baseRpc.ts for why no single endpoint is reliable.
    this.baseConnection      = new Connection(BASE_RPC_PRIMARY, {
      commitment: "confirmed",
      fetch: resilientBaseFetch as unknown as typeof fetch,
    });
    this.sessionKeys         = new SessionKeyManager();
  }

  // ── Base-layer RPC backoff ────────────────────────────────────────────
  // api.devnet.solana.com rate-limits aggressively. When it returns 429 we
  // back off exponentially (5s → 60s) instead of hammering it — hammering
  // extends the ban, which makes discovery fail, which makes remote players
  // flap in and out of the city.
  private rpcBackoffMs = 0;
  private rpcBackoffUntil = 0;

  private noteRpcSuccess(): void {
    this.rpcBackoffMs = 0;
  }

  private isRateLimitError(err: unknown): boolean {
    const msg = (err as Error)?.message ?? String(err);
    return msg.includes("429") || /too many requests|rate limit/i.test(msg);
  }

  private noteRpcError(err: unknown): void {
    if (!this.isRateLimitError(err)) return;
    this.rpcBackoffMs = Math.min(Math.max(this.rpcBackoffMs * 2, 5_000), 60_000);
    this.rpcBackoffUntil = Date.now() + this.rpcBackoffMs;
    console.warn(`[Multiplayer] devnet RPC rate-limited — backing off ${this.rpcBackoffMs / 1000}s`);
  }

  /**
   * Runs a base-layer RPC call with retries on 429. The recurring pollers
   * simply skip rate-limited ticks, but the one-shot connect sequence
   * (init / authorize / delegate) must eventually succeed or the session
   * silently degrades to the base-layer fallback for its whole lifetime —
   * exactly what a transient 429 during the connect burst was causing.
   */
  private async baseRpcWithRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      // Honor the global backoff window, plus a growing delay between tries.
      const wait = Math.max(this.rpcBackoffUntil - Date.now(), i === 0 ? 0 : 2_000 * i);
      if (wait > 0) await new Promise(r => setTimeout(r, Math.min(wait, 15_000)));
      try {
        const res = await fn();
        this.noteRpcSuccess();
        return res;
      } catch (err) {
        lastErr = err;
        this.noteRpcError(err);
        if (!this.isRateLimitError(err)) throw err; // real error — don't mask it
      }
    }
    throw lastErr;
  }

  get connected(): boolean { return this._connected; }
  get sessionId(): string  { return this.wallet?.toBase58() ?? ""; }
  getSessionKeys(): SessionKeyManager { return this.sessionKeys; }

  /**
   * Whether a player PDA is delegated to the ER — checked via the delegation
   * RECORD account (owned by the delegation program, always on base, never
   * delegated itself), so it reads correctly through the router. The player
   * PDA's own owner can't be used: the router serves the ER copy of a
   * delegated account, whose owner is our program either way.
   */
  /**
   * Whether the account is delegated, asked of the account itself.
   *
   * The OWNER of the base account is the answer. Delegation hands the account
   * to the delegation program; undelegation hands it back. Nothing else is
   * reliable, and in particular the delegation RECORD is not: it is what this
   * used to check, and it outlives an undelegation that has not settled on
   * base yet.
   *
   * That gap is not rare, it is the normal path. "committed & undelegated"
   * followed by "undelegate didn't settle in time" leaves the account already
   * handed back on the ROLLUP while base still shows the record. The old check
   * read that as "still delegated", so the client kept writing to a rollup
   * that no longer accepted the account, and every move failed with
   * InvalidWritableAccount until the tab was closed. Nothing re-delegated,
   * because as far as the client knew nothing needed to.
   */
  private async isPdaDelegated(playerPDA: PublicKey): Promise<boolean> {
    try {
      const info = await this.baseConnection.getAccountInfo(playerPDA);
      // No account at all is not delegated: it has never been created.
      return info !== null && info.owner.equals(DELEGATION_PROGRAM_ID);
    } catch {
      return false;
    }
  }

  // ── Connect ──────────────────────────────────────────────────────────

  async connect(walletPublicKey: PublicKey, displayName?: string, loadout?: Loadout): Promise<void> {
    if (this._connected) return; // prevent duplicate initialization from wallet adapter re-fires
    this.wallet = walletPublicKey;
    this.localLoadout = loadout;
    this.displayName = displayName;
    const walletStr = walletPublicKey.toBase58();

    // Session key authorization happens inside startMagicBlockMultiplayer (real)
    // or in the simulation branch below, routed to the correct connection.

    this._connected = true;

    // Register local player
    this.knownPlayers.set(walletStr, {
      wallet: walletStr,
      x: 512, y: 288,
      direction: 0,
      isWalking: false,
      lastUpdate: Date.now(),
      displayName,
      loadout,
    });

    // Layer 1: BroadcastChannel (immediate, zero-infra)
    this.startBroadcastChannel(walletStr, displayName);

    // Layer 2: MagicBlock ephemeral rollup (when Anchor program is deployed)
    if (isProgramDeployed()) {
      await this.startMagicBlockMultiplayer(walletPublicKey, displayName);
    } else {
      const initEntry = transactionLog.record({
        kind: "init", layer: "base",
        label: "Initialize player PDA", status: "pending",
      });
      transactionLog.markConfirmed(initEntry.id, "sim:init");

      const delEntry = transactionLog.record({
        kind: "delegate", layer: "base",
        label: "Delegate PDA → Ephemeral Rollup", status: "pending",
      });
      transactionLog.markConfirmed(delEntry.id, "sim:delegate");

      // Session key in sim mode — connect to base layer for authorize
      await this.sessionKeys.authorize(walletPublicKey, this.baseConnection);
      // No program deployed: local play is as online as it gets, and the
      // connect screen must not wait for a rollup that cannot exist.
      this.setOnline(true);
    }

    // Stale player cleanup (every 15s)
    this.cleanupInterval = setInterval(() => this.pruneStale(), 15_000);

    console.log(`[Multiplayer] connected as ${walletStr.slice(0, 8)}… | program=${isProgramDeployed() ? "real" : "sim"}`);
  }

  disconnect(): void {
    if (!this._connected) return;

    // Broadcast departure to other tabs
    this.bc?.postMessage({ t: "leave", w: this.wallet?.toBase58() ?? "" } satisfies BCMsg);
    this.bc?.close();
    this.bc = null;

    // Unsubscribe per-player account listeners. subscribeToPlayerWallet
    // creates them; try both connections, since removing an unknown id is a
    // no-op and the id does not say which one it came from.
    for (const subId of this.accountSubs.values()) {
      this.baseConnection.removeAccountChangeListener(subId).catch(() => {});
      this.ephemeralConnection.removeAccountChangeListener(subId).catch(() => {});
    }
    this.accountSubs.clear();
    this.lastSlot.clear();
    this.lastDiscoveryBytes.clear();
    this.setOnline(false);

    // Remove the program-wide and chat-log subscriptions — leaking these
    // across reconnect cycles exhausts devnet's connection-level rate limit.
    if (this.programSubId !== null) {
      this.baseConnection.removeProgramAccountChangeListener(this.programSubId).catch(() => {});
      this.programSubId = null;
    }

    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
    if (this.lookDebounce) { clearTimeout(this.lookDebounce); this.lookDebounce = null; }
    if (this.lookRebroadcastTimer) { clearTimeout(this.lookRebroadcastTimer); this.lookRebroadcastTimer = null; }
    this.pendingLoadouts.clear();
    for (const t of this.discoveryTimers) clearInterval(t);
    this.discoveryTimers = [];
    // Drop back to the local hunt slot so a disconnected client still shows a
    // sensible countdown instead of a frozen on-chain one.
    clearHuntFromChain();

    if (isProgramDeployed() && this.wallet) {
      this.commitAndUndelegatePlayer(this.wallet).catch(() => {});
    } else {
      const entry = transactionLog.record({
        kind: "undelegate", layer: "base",
        label: "Commit & undelegate session", status: "pending",
      });
      transactionLog.markConfirmed(entry.id, "sim:undelegate");
    }

    this._connected = false;
    this.sessionKeys.revoke(this.routerConnection);
    // Tell the scene to tear down every remote avatar before wiping the
    // registry, so a reconnect re-adds fresh ones instead of stacking new
    // sprites over orphaned ones (the "2-3 copies of the same player" bug).
    const selfStr = this.wallet?.toBase58();
    for (const w of this.knownPlayers.keys()) {
      if (w === selfStr) continue;
      for (const cb of this.removeCallbacks) cb(w);
    }
    this.knownPlayers.clear();
  }

  /**
   * Manual recovery: forces a fresh commit_and_undelegate + full reconnect,
   * even mid-session. Use this to unstick a wallet whose PDA is delegated
   * from a session that never cleanly undelegated (e.g. a closed tab) —
   * without it, that wallet's every future connect attempt skips
   * delegate_pda entirely (it already looks delegated) and never re-prompts
   * for a fresh delegation signature.
   */
  async resetSession(): Promise<void> {
    if (!this.wallet) throw new Error("resetSession: not connected");
    const wallet = this.wallet;
    const displayName = this.knownPlayers.get(wallet.toBase58())?.displayName;
    const [playerPDA] = derivePlayerPDA(wallet);

    this.disconnect();

    // Poll the BASE layer until ownership actually reverts to our program —
    // a fixed sleep here previously reconnected before the ephemeral
    // rollup's commit+undelegate had settled. Reconnecting too early reads
    // the PDA as still delegated, so the client skips delegate_pda and
    // re-authorizes on the (about to be torn down) old rollup session
    // instead — moves work for a bit, then start failing once the rollup
    // actually finishes undelegating out from under it.
    const maxAttempts = 15; // ~12s worst case
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        // Undelegate is settled once the delegation record is gone.
        if (!(await this.isPdaDelegated(playerPDA))) {
          console.log(`[Multiplayer] undelegate settled after ${(i + 1) * 800}ms`);
          break;
        }
      } catch { /* keep polling */ }
      if (i === maxAttempts - 1) {
        console.warn("[Multiplayer] undelegate didn't settle in time — reconnecting anyway");
      }
    }

    await this.connect(wallet, displayName);
  }

  // ── Send input ────────────────────────────────────────────────────────

  sendInput(x: number, y: number, direction: string, isWalking: boolean, buffIndex: number | null = null): void {
    const roundX = Math.round(x);
    const roundY = Math.round(y);
    const dirNum = DIR_NUM[direction] ?? 0;

    // Skip if nothing actually changed — avoids flooding with idle updates
    if (
      roundX === this.lastPos.x &&
      roundY === this.lastPos.y &&
      dirNum === this.lastPos.direction &&
      isWalking === this.lastPos.isWalking &&
      buffIndex === this.lastPos.buffIndex
    ) return;

    // Two throttles, not one. A walk in a straight line only needs a sample
    // every POS_THROTTLE_MS — the receiver interpolates between them. But the
    // moments that READ as lag are the turns and the stops: with a single
    // 500ms gate, a player who turns a corner or halts right after a sample
    // keeps walking on every other screen for up to half a second, and their
    // avatar then snaps. Those events go out on the leading edge instead,
    // floored only by POS_EVENT_MIN_MS so a key-mash can't flood the rollup.
    const now = Date.now();
    const isEvent =
      dirNum !== this.lastPos.direction || isWalking !== this.lastPos.isWalking
      || buffIndex !== this.lastPos.buffIndex;
    // A stop goes out at once: every millisecond it waits is distance the
    // other screens' prediction carries the avatar past the real spot.
    const stopped = !isWalking && this.lastPos.isWalking;
    const minGap = stopped ? 0 : isEvent ? POS_EVENT_MIN_MS : POS_THROTTLE_MS;
    if (now - this.lastPosSent < minGap) return;
    this.lastPosSent = now;

    this.lastPos = { x: roundX, y: roundY, direction: dirNum, isWalking, buffIndex };

    // Not connected — log sim entry so the activity log stays active without a wallet
    if (!this._connected || !this.wallet) {
      transactionLog.recordMove({ signature: "sim:move", status: "confirmed" });
      return;
    }

    // Update local registry immediately
    const walletStr = this.wallet.toBase58();
    const local = this.knownPlayers.get(walletStr);
    if (local) {
      local.x = roundX; local.y = roundY;
      local.direction = dirNum; local.isWalking = isWalking; local.buffIndex = buffIndex;
      local.lastUpdate = now;
    }

    // Layer 1: BroadcastChannel
    this.bc?.postMessage({
      t: "pos", w: walletStr,
      x: roundX, y: roundY,
      d: dirNum, m: isWalking, b: buffIndex,
    } satisfies BCMsg);

    // Layer 2: on-chain position update
    if (isProgramDeployed()) {
      this.pushPosition(x, y, packDirection(dirNum, isWalking, buffIndex));
    } else {
      transactionLog.recordMove({ signature: "sim:move", status: "confirmed" });
    }
  }

  /**
   * Writes a position on-chain and keeps the "are we actually visible to
   * other players" signal up to date. Shared by real movement and by the
   * idle heartbeat below.
   */
  private pushPosition(x: number, y: number, dirNum: number): void {
    // Record the layer this move will actually be sent to — when
    // delegation failed and we fall back to base devnet, the explorer
    // link must query base, not the ER (which would show nothing).
    const entry = transactionLog.recordMove({
      status: "pending",
      layer: this.useEphemeral ? "ephemeral" : "base",
    });
    const sentAt = Date.now();
    this.lastChainSendAt = sentAt;
    this.moveCost.total++;
    this.sendPositionTransaction(x, y, dirNum)
      .then(sig => {
        if (sig) {
          // How long the network took to accept it — the number the player
          // sees in the on-chain log.
          const rtt = Date.now() - sentAt;
          transactionLog.attachSignature(entry.id, sig, rtt);
          // Smoothed, because the renderer leans on it: how long OUR write
          // takes to be accepted is the best estimate this client has of how
          // long somebody else's takes to reach us. See getMoveRttMs.
          this.moveRttMs = this.moveRttMs === 0 ? rtt : (this.moveRttMs * 3 + rtt) / 4;
          this.noteMoveSent(true);
          this.trackMoveConfirmation(entry.id, sig);
        } else {
          // A single un-submitted position move is transient and self-heals —
          // the next move overwrites the position — so don't paint the whole
          // coalesced batch red. Other moves in it keep it confirmed; only a
          // genuine on-chain rejection (trackMoveConfirmation) turns it red.
          console.warn("[Multiplayer] position tx returned null sig (transient, dropped)");
          this.noteMoveSent(false);
        }
      })
      .catch(err => {
        transactionLog.markFailed(entry.id, err?.message ?? "tx failed");
        this.noteMoveSent(false);
        if ((this as any)._posErrCount === undefined) (this as any)._posErrCount = 0;
        if (++(this as any)._posErrCount <= 3) {
          console.warn("[Multiplayer] position tx failed:", err?.message);
        }
      });
  }

  /**
   * Standing still writes nothing, and everyone else drops a player whose
   * on-chain last_active is older than IDLE_TIMEOUT_MS — so a player reading
   * a panel or idling by the fountain used to vanish from the city after two
   * minutes and stay gone until they moved again. A cheap re-write of the
   * position we already hold keeps them present without any visible motion.
   */
  private heartbeat(): void {
    if (!this._connected || !this.wallet || !isProgramDeployed()) return;
    if (this.lastPos.x < 0) return; // no position written yet this session
    if (Date.now() - this.lastChainSendAt < HEARTBEAT_MS) return;
    this.pushPosition(this.lastPos.x, this.lastPos.y, packDirection(this.lastPos.direction, this.lastPos.isWalking, this.lastPos.buffIndex));
  }

  sendChat(text: string): void {
    if (!this.wallet) return;
    // Layer 1: BroadcastChannel (same browser, instant)
    this.bc?.postMessage({ t: "chat", w: this.wallet.toBase58(), text } satisfies BCMsg);
    // Layer 2: cross-device — write the message onto our ER PDA. Others read
    // last_message + message_at off the poll (bubble + log). No base memo.
    if (isProgramDeployed() && this.wallet) {
      const sk = this.sessionKeys.getSessionPublicKey();
      const preview = text.length > 24 ? text.slice(0, 24) + "…" : text;
      this.sendSessionIx(buildSendChatSessionIx(this.wallet, sk, text), {
        kind: "chat", label: `Chat → "${preview}"`,
      });
    }
  }

  /**
   * Sends a Solana Memo transaction so other browsers receive the chat.
   * The memo text is: "solcity-chat:DISPLAY_NAME:MESSAGE"
   * The player PDA is included as a readonly account so getSignaturesForAddress
   * on the PDA returns this tx — used for polling fallback.
   * Primary channel: onLogs subscription fires in near real-time.
   */
  private async sendChatMemo(text: string): Promise<void> {
    if (!this.wallet) return;
    const displayName = this.knownPlayers.get(this.wallet.toBase58())?.displayName
      ?? this.wallet.toBase58().slice(0, 8);
    // Wallet is included so receivers can float the bubble over the right avatar.
    await this.sendMemo(`${CHAT_PREFIX}${this.wallet.toBase58()}:${displayName}:${text.slice(0, 200)}`);
  }

  /** Broadcasts our loadout cross-device so others render our real avatar. */
  private async sendLookMemo(loadout: Loadout): Promise<void> {
    const w = this.wallet?.toBase58();
    if (!w) return;
    const entry = transactionLog.record({ kind: "system", layer: "base", label: "Outfit broadcast", status: "pending" });
    try {
      const sig = await this.sendMemo(`${LOOK_PREFIX}${w}:${encodeLoadout(loadout)}`);
      transactionLog.markConfirmed(entry.id, sig);
    } catch (e: any) {
      transactionLog.markFailed(entry.id, e?.message ?? "look memo failed");
      console.warn("[Multiplayer] look memo failed:", e?.message);
    }
  }

  /** Broadcasts a facial expression cross-device. */
  private async sendExprMemo(textureKey: string): Promise<void> {
    const w = this.wallet?.toBase58();
    if (!w) return;
    const entry = transactionLog.record({ kind: "system", layer: "base", label: "Expression broadcast", status: "pending" });
    try {
      const sig = await this.sendMemo(`${EXPR_PREFIX}${w}:${textureKey}`);
      transactionLog.markConfirmed(entry.id, sig);
    } catch (e: any) {
      transactionLog.markFailed(entry.id, e?.message ?? "expr memo failed");
      console.warn("[Multiplayer] expr memo failed:", e?.message);
    }
  }

  /**
   * Sends a Solana Memo signed by the session key (no wallet popup). The player
   * PDA is attached readonly so getSignaturesForAddress on it finds the tx; the
   * primary delivery is the onLogs subscription (near real-time, cross-device).
   * Returns the signature. Uses preflight so a real failure (e.g. the session
   * key having no base-layer SOL for the fee) throws with a clear reason instead
   * of silently never landing.
   */
  private async sendMemo(memoText: string): Promise<string> {
    if (!this.wallet) throw new Error("sendMemo: no wallet");
    const sessionKey = this.sessionKeys.getSessionPublicKey();
    // NO accounts on the memo instruction. The SPL Memo program requires that
    // EVERY account passed to it be a signer — attaching the player PDA (a
    // non-signer, "for signature lookup") made every memo fail simulation with
    // "missing required signature for instruction", which is why chat, outfit
    // and expression never crossed devices. The memo text is logged regardless
    // of accounts, and attribution already rides in the payload (the wallet).
    const ix = new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoText, "utf-8"),
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = sessionKey;
    const { blockhash } = await this.baseConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    this.sessionKeys.signTransaction(tx);
    return await this.baseConnection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  }

  /**
   * Sends a record_swap / record_transfer / record_bounty transaction
   * to the base layer when the program is deployed.
   * Main wallet signs (one popup per action — acceptable since these are rare).
   * Falls back to a no-op in simulation mode.
   */
  async recordAction(kind: "swap" | "transfer" | "bounty"): Promise<void> {
    if (!this.wallet || !isProgramDeployed()) return;

    const label = kind === "swap" ? "Record swap" : kind === "transfer" ? "Record transfer" : "Record bounty";
    const logKind = kind === "swap" ? "swap" : kind === "transfer" ? "transfer" : "bounty";
    const entry = transactionLog.record({ kind: logKind, layer: "base", label, status: "pending" });

    try {
      const ix =
        kind === "swap"     ? buildRecordSwapIx(this.wallet) :
        kind === "transfer" ? buildRecordTransferIx(this.wallet) :
                              buildRecordBountyIx(this.wallet);

      const { blockhash } = await this.baseConnection.getLatestBlockhash();
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: this.wallet,
      }).add(ix);

      const sig = await this.signAndSendViaWallet(tx);
      await this.confirmReal(this.baseConnection, sig);
      transactionLog.markConfirmed(entry.id, sig);
    } catch (err: any) {
      transactionLog.markFailed(entry.id, err?.message ?? "record failed");
    }
  }

  /**
   * Records a mini-game result via session key — no wallet popup.
   * Win: score += 100, bounty_count += 1. Loss: last_active only.
   * Sends on the SAME seamless session path as position/outfit (ER when
   * delegated, base otherwise) — NOT the Magic Router, which HANGS on
   * sendRawTransaction (that silently dropped every mini-game record).
   * Falls back to transactionLog simulation when program is not deployed.
   */
  /**
   * One finished mini-game run, best score and all.
   *
   * This replaced `recordMiniGame(success)`, which sent
   * `record_mini_game_session` and threw the score away. The program had
   * carried `game_bests` and `record_game_score_session` since the player_v3
   * deploy and nothing had ever called them, so the boards stayed off chain
   * for no reason but an unwritten client.
   *
   * ONE instruction, not two. The new one already awards the same flat win
   * points and bumps bounty_count, so sending the old one beside it would pay
   * twice for one match.
   *
   * A game with no slot still gets its win points, through the older
   * instruction, but no record: filing its score under slot 0 by default
   * would overwrite Food Cart's board with a stranger's number.
   */
  async recordGameScore(gameId: string, score: number, success: boolean): Promise<void> {
    const slot = gameSlotOf(gameId);
    if (slot < 0) {
      console.warn(`[Multiplayer] no on-chain slot for mini-game "${gameId}", best not recorded`);
      await this.recordScoreSession(
        success, success ? 100 : 0, success ? "Mini-game win" : "Mini-game loss", "minigame",
      );
      return;
    }
    await this.recordScoreSession(
      success, score, `${gameId} ${success ? "win" : "run"}${score ? ` · ${score}` : ""}`,
      "minigame", slot,
    );
  }

  /**
   * Records a session-key score event (record_mini_game_session) on the ER —
   * no wallet popup. `scoreDelta` is added to the player's score on success and
   * bounty_count is bumped by 1. Sent on the seamless session path (ER when
   * delegated, base otherwise), NOT the Magic Router (which hangs on sends).
   */
  private async recordScoreSession(
    success: boolean, scoreDelta: number, label: string, kind: "minigame" | "hunt",
    gameSlot?: number,
  ): Promise<void> {
    const layer = this.useEphemeral ? "ephemeral" : "base";
    const entry = transactionLog.record({ kind, layer, label, status: "pending" });

    if (!this.wallet || !isProgramDeployed()) {
      transactionLog.markConfirmed(entry.id, "sim:score");
      return;
    }

    const sessionKey = this.sessionKeys.getSessionPublicKey();
    const conn = this.useEphemeral ? this.ephemeralConnection : this.baseConnection;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt === 1) this.cachedMoveBlockhash = null;
        // The hunt has no board of its own, so it keeps the older
        // instruction and its own score delta. A mini-game goes through the
        // one that also keeps the best.
        const ix = gameSlot === undefined
          ? buildRecordMiniGameSessionIx(this.wallet, sessionKey, success, scoreDelta)
          : buildRecordGameScoreSessionIx(this.wallet, sessionKey, gameSlot, scoreDelta, success);
        const tx = new Transaction().add(ix);
        tx.feePayer = sessionKey;
        tx.recentBlockhash = await this.getMoveBlockhash(layer);
        this.sessionKeys.signTransaction(tx);
        const sig = await OnChainMultiplayer.withTimeout(
          conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }), 6_000,
        );
        transactionLog.markConfirmed(entry.id, sig);
        console.log(`[Multiplayer] score recorded (${label}):`, sig.slice(0, 12));
        return;
      } catch (err: any) {
        this.cachedMoveBlockhash = null;
        if (attempt === 1) transactionLog.markFailed(entry.id, err?.message ?? "score record failed");
      }
    }
  }

  // ── Global "Find Someone" hunt (shared HuntState on base) ─────────────────
  // The hunt account isn't delegated (low frequency: one write per 5-min round
  // city-wide), so its reads/writes live on base. Writes are session-signed
  // (seamless). The round drives the shared target citizen; claim_find is
  // first-writer-wins so exactly one player scores per round, and the round it
  // advances is the "next citizen" signal every client's poll picks up.

  // The last crank attempt, so a round that failed to advance is tried again.
  // This used to be a single `lastCrankedRound` number set before the send, so
  // ONE failed attempt — a timed-out base RPC, a send that never landed —
  // retired the round forever: the deadline stayed in the past, every later
  // tick returned early on the guard, and the hunt froze on a citizen that
  // could no longer be found or expired for the rest of the session. The round
  // is now only retired once the chain has actually moved past it.
  /**
   * Session key -> wallet, for everyone the position poll has seen.
   *
   * The hunt records its winner as the SESSION key that signed the claim, which
   * is not an identity anybody recognises. The poll already walks every online
   * player's account, and that account carries both keys, so the mapping costs
   * nothing beyond keeping the bytes it was already stepping over.
   */
  private sessionToWallet = new Map<string, string>();


  /** Sends a session-signed instruction to the hunt on BASE, fire-and-forget
   *  with one fresh-blockhash retry. Returns the signature, or null on failure. */
  private async sendHuntIx(ix: TransactionInstruction): Promise<HuntSend> {
    const sessionKey = this.sessionKeys.getSessionPublicKey();
    let error = "no attempt was made";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt === 1) this.cachedMoveBlockhash = null;
        const tx = new Transaction().add(ix);
        tx.feePayer = sessionKey;
        tx.recentBlockhash = await this.getMoveBlockhash("base");
        this.sessionKeys.signTransaction(tx);
        // Preflight ON. It was skipped to save a round trip, which also threw
        // away the only account of WHY a hunt write did not happen: a skipped
        // send that the leader then drops leaves nothing on chain and nothing
        // in hand, which is how finds failed silently for a day. A hunt write
        // happens at most once per round, so the round trip is affordable and
        // the reason is worth more than the millisecond.
        //
        // The timeout has to outlast the failover underneath it: baseRpc walks
        // two endpoints at 8s each, so a budget of 8s here guaranteed that a
        // slow first endpoint was abandoned BEFORE the second was ever tried.
        return {
          signature: await OnChainMultiplayer.withTimeout(
            this.baseConnection.sendRawTransaction(tx.serialize()), 20_000,
          ),
          error: null,
        };
      } catch (err: any) {
        this.cachedMoveBlockhash = null;
        error = err?.message ?? String(err);
        console.warn(`[Hunt] send attempt ${attempt + 1} failed:`, error);
      }
    }
    return { signature: null, error };
  }

  /** Creates the global hunt account if it doesn't exist yet (first player ever).
   *  `init` makes a concurrent double-create fail harmlessly. */
  private async ensureHuntInitialized(): Promise<void> {
    if (!this.wallet || !isProgramDeployed()) return;
    try {
      const [huntPda] = deriveHuntPDA();
      const info = await this.baseConnection.getAccountInfo(huntPda);
      if (info) return; // already initialized
      const sessionKey = this.sessionKeys.getSessionPublicKey();
      await this.sendHuntIx(buildInitializeHuntIx(sessionKey));
      console.log("[Hunt] initialize_hunt sent (first player)");
    } catch (err: any) {
      console.warn("[Hunt] init check failed:", err?.message);
    }
  }

  /** Reads the on-chain hunt and pushes round + deadline into WhereIsNPCGame,
   *  so every client targets the same citizen and shares the countdown. */
  /**
   * The wallet behind the session key the hunt recorded as its winner.
   *
   * Null when nobody claimed the round (the program stores the default key for
   * an expired one) or when the finder is not a player this client has seen —
   * better to say nothing than to put up a key nobody recognises.
   */
  private resolveWinner(winner: PublicKey): string | null {
    if (winner.equals(PublicKey.default)) return null;
    const key = winner.toBase58();
    if (key === this.sessionKeys.getSessionPublicKey().toBase58()) {
      return this.wallet?.toBase58() ?? null;
    }
    return this.sessionToWallet.get(key) ?? null;
  }

  private async pollHunt(): Promise<void> {
    if (!isProgramDeployed()) return;
    // Only let the shared hunt drive this client if this client can also push
    // it forward. Every write — claim, crank, init — needs the wallet, while
    // this read needed nothing, so a player with no wallet connected adopted
    // the chain's round and its deadline and then had no way to advance
    // either: the countdown sat at 0:00 and the citizen never changed, for as
    // long as nobody with a wallet was in the city to crank it. Without a
    // wallet the local hunt is the honest one to play.
    if (!this.wallet) {
      clearHuntFromChain();
      return;
    }
    try {
      const [huntPda] = deriveHuntPDA();
      const info = await this.baseConnection.getAccountInfo(huntPda);
      if (!info) return; // not initialized yet (ensureHuntInitialized will make it)
      const hunt = decodeHuntState(info.data, this.chainNowSecs());
      if (hunt) setHuntFromChain(hunt.round, hunt.deadline, this.resolveWinner(hunt.winner));
    } catch { /* transient RPC — keep the last known round */ }
  }

  /** First-finder claim for `round`. First-writer-wins on-chain: if we land it
   *  we scored (points recorded on our player PDA via the ER); if someone beat
   *  us the tx no-ops on the stale-round guard. Refreshes the hunt right after
   *  so the new round shows promptly. */
  async claimFind(round: number): Promise<ClaimResult> {
    if (!this.wallet || !isProgramDeployed()) return { won: false, roundMoved: false };
    const sessionKey = this.sessionKeys.getSessionPublicKey();
    const entry = transactionLog.record({
      kind: "hunt", layer: "base", label: "Find someone: claim", status: "pending",
    });
    const sent = await this.sendHuntIx(buildClaimFindIx(sessionKey, round));

    // Confirm by reading the hunt: our claim landed iff the winner is our
    // session key and the round moved on. Polled rather than slept on once —
    // a fixed 1.2s wait called a slow devnet a loss, and the caller needs the
    // difference between "somebody beat me" and "my claim never landed" to know
    // whether the citizen is really gone.
    let hunt: { round: number; winner: PublicKey; deadline: number } | null = null;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 700 : 500));
      try {
        const [huntPda] = deriveHuntPDA();
        const info = await this.baseConnection.getAccountInfo(huntPda);
        hunt = info ? decodeHuntState(info.data, this.chainNowSecs()) : null;
      } catch { /* transient RPC: try again */ }
      if (hunt && hunt.round !== round) break;
    }

    const roundMoved = !!hunt && hunt.round !== round;
    // Push the new round and deadline from the account we ALREADY read.
    //
    // This used to call pollHunt(), which fetched the very same account again
    // just to hand the countdown its new deadline. That second read goes
    // through the base failover like any other, so when it was slow or failed
    // the clock did not reset on the find at all: it kept running the old
    // deadline down until some later 3s poll happened to get through, which is
    // why the next citizen's timer appeared minutes late instead of at once.
    // The data was in hand the whole time.
    if (roundMoved && hunt) {
      setHuntFromChain(hunt.round, hunt.deadline, this.resolveWinner(hunt.winner));
    }
    const won = roundMoved && !!hunt && hunt.winner.equals(sessionKey);
    if (won && sent.signature) {
      transactionLog.markConfirmed(entry.id, sent.signature);
      // A find is worth exactly +1 (not +100) — a single point per citizen, the
      // Find Someone leaderboard metric. Recorded on the ER (seamless) on the
      // finder's player PDA.
      this.recordScoreSession(true, 1, "Find someone ★ +1", "hunt").catch(() => {});
    } else {
      // The reason, not just the verdict: the transaction log is the one place
      // a player (or whoever is running an event) can read why a find did not
      // score, and "it did not land" without the cause is what made this take a
      // day to find.
      transactionLog.markFailed(
        entry.id,
        roundMoved ? "another player claimed this round first"
                   : `the claim did not land: ${sent.error ?? "unknown"}`,
      );
    }
    return { won, roundMoved };
  }

  onPlayerAdd(cb: PlayerCallback):    void { this.addCallbacks.push(cb); }
  onPlayerRemove(cb: RemoveCallback): void { this.removeCallbacks.push(cb); }
  onPlayerChange(cb: PlayerCallback): void { this.changeCallbacks.push(cb); }
  onPlayerExpression(cb: ExprCallback): void { this.exprCallbacks.push(cb); }

  /** Returns all currently known players (self included). */
  getActivePlayers(): OnChainPlayer[] {
    return Array.from(this.knownPlayers.values());
  }

  /** Returns what we know about one player (for the click-to-view profile card). */
  getPlayer(wallet: string): OnChainPlayer | undefined {
    return this.knownPlayers.get(wallet);
  }

  /** Called by CityScene when the local player's score changes. */
  updateScore(score: number): void {
    this.localScore = score;
    const walletStr = this.wallet?.toBase58();
    if (walletStr) {
      const local = this.knownPlayers.get(walletStr);
      if (local) local.score = score;
    }
  }

  /** Broadcast a new paper-doll loadout so others re-render our avatar. */
  updateLoadout(loadout: Loadout): void {
    this.localLoadout = loadout;
    const walletStr = this.wallet?.toBase58();
    if (walletStr) {
      const local = this.knownPlayers.get(walletStr);
      if (local) local.loadout = loadout;
    }
    // Debounce: the wardrobe fires this on every live-preview tweak; only the
    // settled look needs to go out to others.
    if (this.lookDebounce) clearTimeout(this.lookDebounce);
    this.lookDebounce = setTimeout(() => {
      this.lookDebounce = null;
      if (!walletStr) return;
      this.bc?.postMessage({ t: "look", w: walletStr, l: loadout } satisfies BCMsg); // same-tab
      // cross-device: write the loadout onto our delegated PDA on the ER; others
      // pick it up from the same position poll (no base-layer memo).
      if (isProgramDeployed() && this.wallet) {
        const sk = this.sessionKeys.getSessionPublicKey();
        this.sendSessionIx(buildUpdateLookSessionIx(this.wallet, sk, encodeLoadout(loadout)), {
          kind: "outfit", label: "Outfit change",
        });
      }
    }, 250);
  }

  /**
   * Publishes our achievements + streak onto our own delegated PDA, so the card
   * another player opens on us is not empty.
   *
   * NOT a hot-path write. The caller (social/profilePublisher) only calls this
   * when the summary actually changes, which is a handful of times a session,
   * and readers pay nothing for it: these fields ride the position poll they
   * are already making.
   */
  publishProfile(achievements: Uint8Array, streakCurrent: number, streakBest: number): void {
    if (!isProgramDeployed() || !this.wallet) return;
    const sk = this.sessionKeys.getSessionPublicKey();
    this.sendSessionIx(
      buildPublishProfileSessionIx(this.wallet, sk, achievements, streakCurrent, streakBest),
      { kind: "profile", label: "Profile published" },
    );
  }

  /** Broadcast a facial expression (texture key) so others animate our avatar. */
  sendExpression(textureKey: string): void {
    const walletStr = this.wallet?.toBase58();
    if (!walletStr) return;
    this.bc?.postMessage({ t: "expr", w: walletStr, e: textureKey } satisfies BCMsg); // same-tab
    // Cross-device: write the expression onto our ER PDA (session key, seamless),
    // lightly throttled. Others read expression + expression_at off the poll.
    if (isProgramDeployed() && this.wallet) {
      const now = Date.now();
      if (now - this.lastExprMemoAt > 500) {
        this.lastExprMemoAt = now;
        const sk = this.sessionKeys.getSessionPublicKey();
        this.sendSessionIx(buildSetExpressionSessionIx(this.wallet, sk, textureKey), {
          kind: "expression", label: "Expression",
        });
      }
    }
  }

  /**
   * Broadcast a kick of the beach football so every other client replays the
   * same roll (see world/BeachBall for why only the kick travels).
   *
   * It rides our own PlayerState chat field on the ER, tagged, the same way a
   * Stocklana trade does: that is the channel that is actually live
   * cross-device, read off the 500ms player poll and the websocket push. The
   * base-layer Memo channel this used at first is retired — nothing has
   * subscribed to it since chat moved onto the rollup, so those kicks were
   * written to devnet and heard by nobody.
   *
   * Fire and forget. A kick that fails to land is a kick other people did not
   * see; the next one carries an absolute snapshot and puts them right again,
   * so there is nothing here worth retrying or telling the player about.
   */
  sendBallKick(kick: BallKick): void {
    const walletStr = this.wallet?.toBase58();
    if (!walletStr) return;
    this.bc?.postMessage({ t: "ball", w: walletStr, k: kick } satisfies BCMsg); // same-tab
    if (!isProgramDeployed()) return;
    const sk = this.sessionKeys.getSessionPublicKey();
    this.sendSessionIx(buildSendChatSessionIx(this.wallet!, sk, encodeBallKick(kick)), {
      kind: "ball", label: "Ball kick",
    });
  }

  // ── Layer 1: BroadcastChannel ─────────────────────────────────────────

  private startBroadcastChannel(walletStr: string, displayName?: string): void {
    if (typeof BroadcastChannel === "undefined") return;

    // Close any stale channel before creating a new one — prevents duplicate listeners
    // that accumulate when connect() is called more than once in the same session.
    this.bc?.close();
    this.bc = new BroadcastChannel(BROADCAST_CHANNEL);
    this.bc.onmessage = (event: MessageEvent<BCMsg>) => {
      const msg = event.data;
      if (!msg?.t || !msg?.w) return;
      if (msg.w === walletStr) return; // ignore own messages

      switch (msg.t) {
        case "join":
          this.handlePlayerJoin(msg.w, msg.x, msg.y, msg.d, msg.m, msg.name, msg.score, msg.l);
          // Reply with our position + look so the new joiner sees us correctly
          this.bc?.postMessage({
            t: "join",
            w: walletStr,
            x: this.lastPos.x || 512,
            y: this.lastPos.y || 288,
            d: this.lastPos.direction,
            m: this.lastPos.isWalking,
            name: displayName,
            score: this.localScore,
            l: this.localLoadout,
          } satisfies BCMsg);
          break;
        case "pos":
          this.handlePlayerMove(msg.w, msg.x, msg.y, msg.d, msg.m, undefined, undefined, undefined, msg.b);
          break;
        case "look":
          this.handleLook(msg.w, msg.l);
          break;
        case "expr":
          this.handleExpr(msg.w, msg.e);
          break;
        case "ball":
          // Straight to the scene, same event as the rollup path but with no
          // hop to wait for: another tab of this browser, already here.
          (globalThis as any).__solCityGameEvents?.emit("ball:kick", { kick: msg.k, stale: false });
          break;
        case "leave":
          this.handlePlayerLeave(msg.w);
          break;
      }
    };

    // Announce presence to existing tabs
    this.bc.postMessage({
      t: "join",
      w: walletStr,
      x: 512, y: 288, d: 0, m: false,
      name: displayName,
      score: this.localScore,
      l: this.localLoadout,
    } satisfies BCMsg);

    // Ensure clean broadcast on tab close
    window.addEventListener("beforeunload", () => {
      this.bc?.postMessage({ t: "leave", w: walletStr } satisfies BCMsg);
    });
  }

  // ── Layer 2: Devnet base layer (no ephemeral rollup delegation) ──────────
  // MagicBlock ephemeral rollup devnet endpoints are unreliable for reads
  // (getAccountInfo / WebSocket subscriptions return stale/null data).
  // Using the standard Solana devnet base layer gives reliable reads with
  // ~500ms-1s latency — good enough for cross-browser multiplayer on devnet.
  // Delegation will be re-enabled when launching on mainnet where MagicBlock
  // infrastructure is production-grade.

  /** Surfaces the current connect stage on the login gate (real progress, so a
   *  stall is visible at the exact step instead of a time-based guess). */
  /** Counts which path delivered a player's state, for the [mp] log line. */
  private noteRead(fromPush: boolean): void {
    if (fromPush) this.readsByPush++;
    else this.readsByPoll++;
  }

  /**
   * Once a minute: how many remote states arrived by websocket push versus
   * poll. If pushes stay at 0 while players move, the rollup socket is not
   * delivering and everything rides the 500ms poll.
   */
  private logReadPaths(): void {
    // The move report goes out even alone in the city: it is about this
    // client's own writes, and "why is every move 900ms" is asked by somebody
    // standing on an empty street as often as in a crowd.
    const m = this.moveCost;
    if (m.total > 0) {
      const where = this.useEphemeral
        ? (this.erReadConnections.find(r => r.conn === this.ephemeralConnection)?.id ?? "er")
        : "BASE (not delegated - this is why moves are slow)";
      console.log(
        `[mp] last 60s: ${m.total} moves to ${where}, `
        + `${m.retries} retried, ${m.coldHash} waited for a blockhash`
        + `, rtt ~${Math.round(this.moveRttMs)}ms`,
      );
      this.moveCost = { retries: 0, coldHash: 0, total: 0 };
    }
    if (this.knownPlayers.size <= 1) return;
    console.log(`[mp] last 60s: ${this.readsByPush} states by push, ${this.readsByPoll} by poll`);
    this.readsByPush = 0;
    this.readsByPoll = 0;
  }

  private progress(label: string): void {
    try { (globalThis as any).__solCityGameEvents?.emit("game:sessionProgress", label); } catch {}
  }

  // ── Visible-to-others signal ──────────────────────────────────────────
  //
  // Everyone reads positions off the rollup, so a player whose PDA never got
  // delegated (declined signature, failed delegate, ER unreachable) writes to
  // base and is simply absent from every other screen — while seeing everyone
  // else normally, which reads as "the game is fine, nobody is around". This
  // publishes that state so the UI can say it out loud and offer a retry.

  private setOnline(v: boolean): void {
    // Published as a VALUE as well as an event. The event only fires on a
    // change, so anything that mounts late — or remounts, which is what the
    // connect screen did after a wallet flap — could wait forever for news
    // that had already been announced. That was the "back to the login
    // screen and it never comes back" report.
    try { (globalThis as any).__solCityOnline = v; } catch {}
    if (this.onlineFlag === v) return;
    this.onlineFlag = v;
    try { (globalThis as any).__solCityGameEvents?.emit("multiplayer:online", v); } catch {}
  }

  private noteMoveSent(ok: boolean): void {
    if (ok) {
      this.moveFailStreak = 0;
      if (this.useEphemeral) this.setOnline(true);
      return;
    }
    if (++this.moveFailStreak >= OFFLINE_AFTER_FAILURES) this.setOnline(false);
  }

  /** True once the session is writing to the rollup, where others read it. */
  get visibleToOthers(): boolean {
    return this.onlineFlag === true;
  }

  /**
   * Re-runs the whole on-chain setup (init / authorize / delegate) for the
   * connected wallet. Wired to the "you are hidden" badge, so a player who
   * dismissed a signature or hit a rate-limited RPC can recover without
   * disconnecting the wallet and reloading the city.
   */
  async retryOnline(): Promise<void> {
    if (!this.wallet || this.retrying) return;
    this.retrying = true;
    try {
      this.moveFailStreak = 0;
      await this.startMagicBlockMultiplayer(this.wallet, this.displayName);
    } finally {
      this.retrying = false;
    }
  }

  private async startMagicBlockMultiplayer(wallet: PublicKey, displayName?: string): Promise<void> {
    const walletStr = wallet.toBase58();
    const [playerPDA] = derivePlayerPDA(wallet);

    console.group(`[Multiplayer] setup for ${walletStr.slice(0,8)}…`);

    // 1. Read PDA + delegation state FIRST — where the live copy of the
    //    account resides decides which cluster authorize_session must target.
    //    A delegated PDA is owned by the delegation program on base, so a
    //    base-layer authorize can never write it; and the ER rejects txs
    //    built with base blockhashes. The old "broadcast to both" approach
    //    therefore updated NEITHER copy, leaving the ER with a stale session
    //    key and every move failing with InvalidSessionKey (custom 6000).
    let isDelegated = false;
    // Whether the player PDA exists on-chain. Delegation and session writes are
    // pointless until it does — a missing PDA makes every downstream ix fail
    // with AccountNotInitialized (custom 3012). Gate on this so we never prompt
    // a delegate for a PDA that was never created.
    let pdaReady = false;
    try {
      const existing = await this.baseRpcWithRetry(() => this.baseConnection.getAccountInfo(playerPDA));
      pdaReady = existing !== null;

      // Delegation status via the delegation RECORD (router-safe — the router
      // serves the ER copy of a delegated PDA, so its owner is always our
      // program). A brand-new player (no PDA yet) is not delegated.
      if (existing) {
        isDelegated = await this.isPdaDelegated(playerPDA);
        console.log(`${isDelegated ? "✓ delegated" : "○ not delegated"} (delegation record)`);
      }

      const sessionKey = this.sessionKeys.getSessionPublicKey();
      const name = displayName ?? walletStr.slice(0, 8);

      // Topping the session key up is measured against RENT EXEMPTION, not
      // against zero.
      //
      // A fee payer may not be left holding a non-zero balance below the
      // rent-exempt minimum (650,240 lamports for an account with no data on
      // devnet), so a session key just above that floor can pay for nothing at
      // all: the transaction is rejected outright with "insufficient funds for
      // rent", never reaching the chain. The old threshold of 500,000 sat
      // BELOW the floor, which created a dead band — anything between 500,000
      // and about 655,000 counted as funded and could not send a single
      // transaction. A key that drifted into it stopped claiming finds and
      // stopped cranking the hunt, silently, with nothing on chain to show for
      // it, until somebody read the simulation error.
      //
      // The floor is read from the cluster rather than hardcoded, because it
      // is a cluster parameter and a wrong constant here is invisible until it
      // strands somebody again.
      const rentFloor = await this.baseConnection
        .getMinimumBalanceForRentExemption(0)
        .catch(() => 650_240);
      // Enough for a few hundred base-layer writes on top of the floor. Finds
      // and cranks are the only ones, at 5,000 lamports each.
      const SESSION_FUND_LAMPORTS = rentFloor + 2_500_000;
      const sessionBalance = await this.baseConnection.getBalance(sessionKey).catch(() => 0);
      // Top up well before the floor, so a session that runs long does not end
      // it stranded one fee above the line.
      const needsFunding = sessionBalance < rentFloor + 500_000;

      if (!existing) {
        this.progress("Creating your player (sign)…");
        console.log("… new player — init + auth" + (needsFunding ? " + fund" : "") + " (1 sign prompt)");
        // Logged + confirmed by POLLING the PDA (confirmTransaction's router WS
        // is unreliable). Without this the init failure was invisible — no log
        // entry at all — while every later ix failed 3012 on the missing PDA.
        const initEntry = transactionLog.record({
          kind: "init", layer: "base",
          label: "Initialize player + session", status: "pending",
        });
        try {
          const { blockhash } = await this.baseRpcWithRetry(() => this.baseConnection.getLatestBlockhash());
          const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet })
            .add(buildInitializePlayerIx(wallet, name))
            .add(buildAuthorizeSessionIx(wallet, sessionKey));
          // The unlock account, in the same signature. It has to exist before
          // the first pack and before the first sync, and this is the only
          // moment the player is already signing something: asking for a
          // second popup later, at the till, is how a purchase gets abandoned.
          if (!(await this.accountExists(deriveUnlockPDA(wallet)[0]))) {
            tx.add(buildInitUnlockStateIx(wallet));
          }
          if (needsFunding) {
            tx.add(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: sessionKey, lamports: SESSION_FUND_LAMPORTS }));
          }
          const sig = await this.signAndSendViaWallet(tx);
          this.progress("Confirming your player…");
          pdaReady = await this.waitForAccount(playerPDA, 12, 800);
          if (pdaReady) {
            this.sessionKeys["authorized"] = true;
            transactionLog.markConfirmed(initEntry.id, sig);
            console.log("✓ initialized + authorized:", sig.slice(0, 12));
          } else {
            transactionLog.markFailed(initEntry.id, "player PDA not found after send, init did not land");
            console.warn("✗ init sent but PDA never appeared:", sig.slice(0, 12));
          }
        } catch (err: any) {
          transactionLog.markFailed(initEntry.id, err?.message ?? "init failed");
          console.warn("✗ init/auth failed:", err?.message);
        }
      } else if (!isDelegated) {
        this.progress("Authorizing session…");
        console.log("✓ PDA on base — auth" + (needsFunding ? " + fund (1 sign prompt)" : " (may skip if cached)"));
        await this.sessionKeys.authorize(wallet, this.baseConnection, undefined, needsFunding ? SESSION_FUND_LAMPORTS : 0);
        console.log("✓ session authorized");
      } else {
        // Delegated: the ER copy is the authoritative session state.
        // Re-authorize on the rollup only if its stored key differs from ours
        // — when in sync this whole branch needs no wallet prompt.
        this.progress("Syncing session key…");
        await this.syncSessionKeyOnEr(wallet, playerPDA);
        if (needsFunding) {
          this.progress("Funding session (sign)…");
          console.log("… funding session key (1 sign prompt)");
          const { blockhash } = await this.baseRpcWithRetry(() => this.baseConnection.getLatestBlockhash());
          const fundTx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet })
            .add(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: sessionKey, lamports: SESSION_FUND_LAMPORTS }));
          const sig = await this.signAndSendViaWallet(fundTx);
          await this.confirmReal(this.baseConnection, sig);
        }
      }
    } catch (err: any) {
      console.warn("✗ init/auth failed:", err?.message);
    }

    // Delegate or reuse delegation so position writes go to the ephemeral rollup.
    try {
      if (!pdaReady) {
        console.warn("○ delegation skipped — player PDA not initialized");
        this.useEphemeral = false;
      } else if (!isDelegated) {
        this.progress("Delegating to rollup (sign)…");
        console.log("… delegating PDA to ephemeral rollup (1 sign prompt)");
        this.useEphemeral = await this.delegateToEphemeral(wallet);
      } else {
        this.useEphemeral = true;
        console.log("✓ already delegated — using ephemeral rollup");
        // WHICH rollup. Being delegated says nothing about where, and the
        // default is only right by luck: this account was delegated to Asia
        // while the city defaulted to the US rollup, so every move failed
        // with InvalidWritableAccount from the moment it connected.
        await this.pointWritesAtOwningValidator(playerPDA);
      }
    } catch (err: any) {
      console.warn("○ delegation skipped:", err?.message);
      this.useEphemeral = false;
    }

    // A delegated PDA can ONLY be written on the ER — a base write always fails
    // with AccountOwnedByWrongProgram (custom 3007). If it's delegated on-chain
    // (per the delegation record), force ER regardless of the branch above.
    try {
      if (!this.useEphemeral && await this.isPdaDelegated(playerPDA)) {
        console.log("✓ PDA delegated on-chain — forcing ER writes (base would 3007)");
        this.useEphemeral = true;
      }
    } catch { /* keep the decision above */ }

    console.log(`→ position layer: ${this.useEphemeral ? "🚀 EPHEMERAL ROLLUP" : "📡 BASE DEVNET"}`);
    console.groupEnd();

    // Others read the rollup only: on base we are invisible to the city.
    this.setOnline(this.useEphemeral);

    // 2. Discover existing players from the ER (getProgramAccounts on the
    //    ephemeral endpoint returns exactly the delegated/online players).
    setTimeout(() => this.discoverPlayersFromBase(wallet), 1_500);

    // (No program-account websocket subscription: the router doesn't support
    //  onProgramAccountChange, and the ER poll below carries reads reliably.)

    // 3. Batched ER PDA polling — the real-time read load.
    for (const t of this.discoveryTimers) clearInterval(t);
    this.discoveryTimers = [
      // Poll live positions from the ER (fast, sub-100ms) — this is the
      // real-time load now that reads come off the rollup, not frozen base.
      // 500ms matches the position-write throttle so motion stays continuous.
      // Senders write every POS_THROTTLE_MS (200ms). Polling at 500ms threw
      // away two of every five of those writes and added ~250ms of waiting to
      // every move on top of the network, which is as much as the whole
      // distance between two rollups. One RPC call per tick covers every
      // known player, so the cost of asking more often is small and it is
      // paid by everyone equally, wherever they are.
      setInterval(() => this.pollKnownPlayerPDAs(wallet), 250),
      // Refresh the online roster from the ER. getProgramAccounts on the ER is
      // cheap (~20ms) and returns exactly the delegated (online) players.
      // Someone who just joined only exists for others once this runs, so 12s
      // meant up to twelve seconds of standing next to an invisible player.
      setInterval(() => this.discoverPlayersFromBase(wallet), 5_000),
      // Global "Find Someone" hunt — read the shared round/deadline off base so
      // every client targets the same citizen (low-frequency; every 3s is ample).
      setInterval(() => this.pollHunt(), 3_000),
      // Keep a standing player inside everyone's freshness window.
      setInterval(() => this.heartbeat(), 10_000),
      // Keep a fresh rollup blockhash in hand while the player is moving. The
      // send path used to fetch one every ~2s inline, so one move in four paid
      // a full extra round trip to the validator before it could even be
      // signed. Fetching it off the critical path removes that spike.
      setInterval(() => this.prefetchMoveBlockhash(), 1_200),
      setInterval(() => this.logReadPaths(), 60_000),
    ];

    // Ensure the global hunt exists (first player ever creates it), then seed
    // the round immediately so the target syncs without waiting for the poll.
    this.ensureHuntInitialized().then(() => this.pollHunt());

    // 6. Cross-device chat/outfit/expression now ride the ER PlayerState fields
    //    (read off the position poll), so the base-layer Memo + onLogs channel
    //    is no longer used; the Memo log subscription that served it is gone.

    // 7. Force a presence broadcast on next sendInput tick
    this.lastPos = { x: -1, y: -1, direction: -1, isWalking: false, buffIndex: null };

    // 8. Seed our loadout onto the ER PlayerState so players already in the city
    //    render our real outfit from their next poll (the field persists, so no
    //    re-announce is needed when someone new joins).
    if (this.localLoadout && this.wallet) {
      const sk = this.sessionKeys.getSessionPublicKey();
      this.sendSessionIx(buildUpdateLookSessionIx(this.wallet, sk, encodeLoadout(this.localLoadout)));
    }
  }

  /**
   * Discovers the ONLINE roster from the ER. Delegated player PDAs live on the
   * rollup with fresh positions; the base copy of a delegated account is frozen
   * at its pre-delegation state (spawn) — base discovery is why everyone showed
   * up stuck at 512,288. The ER is the authoritative live view.
   * (Method name kept for its callers.)
   */
  private async discoverPlayersFromBase(_self: PublicKey): Promise<void> {
    try {
      // Every rollup, in parallel, because a player's PDA lives on exactly the
      // one they delegated to and is invisible on the others. In parallel so
      // the sweep costs the SLOWEST endpoint rather than the sum: measured
      // 2026-10-25 from Vietnam, that is ~300ms for three against ~300ms for
      // the one US endpoint alone.
      //
      // A rollup that fails is skipped, not fatal. Losing one means not seeing
      // the players on it, which is strictly better than seeing nobody.
      const perValidator = await Promise.all(
        this.erReadConnections.map(async ({ id, conn }) => {
          try {
            return await conn.getProgramAccounts(SOL_CITY_PROGRAM_ID, SWEEP_CONFIG);
          } catch (err: any) {
            console.warn(`[Multiplayer] ER sweep failed on ${id}:`, err?.message);
            return [];
          }
        }),
      );
      // Deduplicated by address. The same PDA should appear on one rollup, but
      // a delegation that moved can leave a stale copy behind on the old one,
      // and the fresher copy is the live player.
      const byAddress = new Map<string, (typeof perValidator)[number][number]>();
      perValidator.forEach((list, validatorIndex) => {
        for (const entry of list) {
          const key = entry.pubkey.toBase58();
          const seen = byAddress.get(key);
          if (!seen || lastActiveOf(entry.account.data) > lastActiveOf(seen.account.data)) {
            byAddress.set(key, entry);
            this.playerRollup.set(key, validatorIndex);
          }
        }
      });

      // Our own writes follow our own PDA. Not the nearest rollup: the nearest
      // one is where we would delegate a NEW player, but an account already
      // delegated elsewhere can only be written where it actually lives.
      // Deliberately NOT repointing our own writes from this sweep. Which
      // rollup answers with a copy of an account says nothing about which one
      // will accept a write to it: all three answered for the same PDA on
      // 2026-10-26. Only the delegation record knows, and
      // pointWritesAtOwningValidator reads it.
      const accounts = [...byAddress.values()];
      // Candidates, not players: the count before the size filter below. Most
      // of what the Asian rollup still holds is pre-v3 PDAs from an older
      // seed, delegated there and never undelegated, and they are dropped a
      // few lines down. Saying "online players" here made the city look full
      // of people nobody could see.
      console.log(
        `[Multiplayer] ER sweep: ${accounts.length} candidate(s) across `
        + perValidator.map((l, i) => `${this.erReadConnections[i].id}:${l.length}`).join(" "),
      );
      let added = 0;
      for (const { pubkey, account } of accounts) {
        // Skip STALE duplicate PDAs from an older seed still delegated on the ER.
        // The current PlayerState (player_v2, with loadout/expr/chat) is ~505 bytes;
        // pre-v2 accounts are 133/60 bytes. Both decode under the same `authority`,
        // so a stale short account would OVERWRITE the live one in knownPlayers and
        // strand that wallet at a frozen position (one-way visibility). Only the
        // current-layout account is a real, live player.
        // Under dataSlice a short answer means a short ACCOUNT: the slice is
        // clamped to whatever exists, so a pre-v3 PDA still on the rollup
        // comes back under the worst-case length and is skipped here exactly
        // as it was before.
        if (account.data.length < CURRENT_PLAYER_MIN_LEN) continue;
        const before = this.knownPlayers.size;
        this.decodeAndUpdatePlayer(pubkey.toBase58(), account.data);
        if (this.knownPlayers.size > before) added++;
      }
      if (added > 0) console.log(`[Multiplayer] discovery: ${added} new player(s)`);
    } catch (err: any) {
      console.warn("[Multiplayer] ER discovery failed:", err?.message);
    }
  }

  /**
   * Polls the PDAs of every known player in ONE batched RPC call
   * (getMultipleAccountsInfo) — fallback for when onProgramAccountChange
   * doesn't fire on the RPC node. Batching is the biggest 429 saver: the
   * previous per-player getAccountInfo fan-out multiplied request volume by
   * the number of players every 2 seconds.
   */
  private async pollKnownPlayerPDAs(self: PublicKey): Promise<void> {
    const selfStr = self.toBase58();
    // Every known player, every tick. Skipping players the websocket had
    // pushed recently looked like a saving, but pushes arrive unevenly: a
    // player whose next push was late sat frozen for the whole skip window
    // and then jumped. The poll is the steady clock; pushes only get there
    // sooner.
    const wallets = [...this.knownPlayers.keys()].filter(w => w !== selfStr);
    if (wallets.length === 0) return;

    try {
      // Read from the ER, not base: the ER copy carries live positions; the
      // base copy of a delegated PDA is frozen at spawn.
      const pdas = wallets.map(w => derivePlayerPDA(new PublicKey(w))[0]);

      // Grouped by the rollup each PDA actually lives on. A delegated account
      // is invisible on every other rollup, so asking one for all of them
      // returns null for anybody delegated elsewhere and freezes them.
      //
      // A PDA the sweep has not placed yet goes to the rollup we write to,
      // which is right for everybody while writes are not yet spread and
      // self-corrects on the next sweep once they are.
      const groups = new Map<number, PublicKey[]>();
      const writeIndex = Math.max(
        0, this.erReadConnections.findIndex(r => r.conn === this.ephemeralConnection),
      );
      for (const pda of pdas) {
        const at = this.playerRollup.get(pda.toBase58()) ?? writeIndex;
        const list = groups.get(at);
        if (list) list.push(pda); else groups.set(at, [pda]);
      }

      // In parallel: the poll costs the slowest rollup, not the sum.
      //
      // Slot ordering survives this. `lastSlot` is kept per wallet and a
      // player lives on one rollup, so the slots compared against each other
      // always come from the same clock - which they would NOT if a player
      // could be seen on two.
      await Promise.all([...groups.entries()].map(async ([at, group]) => {
        const { id, conn } = this.erReadConnections[at];
        try {
          // "processed" — lowest-latency ER read; positions are cosmetic so we
          // don't need "confirmed" and the extra latency it adds.
          const { context, value: infos } =
            await conn.getMultipleAccountsInfoAndContext(group, "processed");
          infos.forEach((info, i) => {
            if (info) this.decodeAndUpdatePlayer(group[i].toBase58(), info.data, context.slot);
          });
        } catch { void id; /* transient ER read error — next tick retries */ }
      }));
    } catch { /* transient ER read error — next tick retries */ }
  }

  // Only one move verification runs at a time, and after a verified success
  // we trust the pipe for VERIFY_HEALTHY_WINDOW_MS before sampling again —
  // moves arrive at up to 2/s and each verification polls for a few seconds,
  // so verifying every signature would meaningfully raise RPC volume. A
  // systemic failure (unauthorized session key, dropped txs) still surfaces
  // within one sample window and turns the batch red in the UI.
  private static readonly VERIFY_HEALTHY_WINDOW_MS = 10_000;
  private moveVerifyBusy = false;
  private lastVerifyOkAt = 0;
  private firstVerifiedLogged = false;

  /**
   * Learns what actually happened to a move tx sent with skipPreflight.
   * sendRawTransaction always returns the tx's own signature (it is derived
   * from the signed bytes, not assigned by the node), so holding a signature
   * proves nothing. getSignatureStatuses distinguishes the three outcomes:
   *   status with err  → executed and failed (session key problem, etc.)
   *   status without err → landed successfully
   *   status null after retries → dropped, never processed — this is exactly
   *     the case where the explorer shows an empty/unknown transaction.
   */
  private async trackMoveConfirmation(entryId: string, sig: string): Promise<void> {
    // Attach the signature immediately so the explorer link exists while pending.
    transactionLog.attachSignature(entryId, sig);

    if (
      this.moveVerifyBusy ||
      Date.now() - this.lastVerifyOkAt < OnChainMultiplayer.VERIFY_HEALTHY_WINDOW_MS
    ) {
      // Sampled out — a recent or in-flight verification covers systemic failures.
      transactionLog.markConfirmed(entryId, sig);
      return;
    }
    this.moveVerifyBusy = true;
    try {
      const conn = this.useEphemeral ? this.ephemeralConnection : this.baseConnection;
      for (const delayMs of [800, 1500, 3000]) {
        await new Promise(r => setTimeout(r, delayMs));
        const st = await conn.getSignatureStatuses([sig]);
        const s = st?.value?.[0];
        if (s) {
          if (s.err) {
            transactionLog.markFailed(entryId, `on-chain error: ${JSON.stringify(s.err)}`);
            console.warn("[Multiplayer] move tx FAILED on-chain:", sig.slice(0, 12), s.err);
            this.lastVerifyOkAt = 0; // unhealthy — verify the next move too
            // "InvalidWritableAccount" from a rollup means one thing: the
            // account is not delegated HERE. Every move will fail until the
            // writes move, so find out where it really lives instead of
            // repeating the question.
            if (JSON.stringify(s.err).includes("InvalidWritableAccount")) {
              void this.relocateWrites();
            }
          } else {
            transactionLog.markConfirmed(entryId, sig);
            this.lastVerifyOkAt = Date.now();
            if (!this.firstVerifiedLogged) {
              this.firstVerifiedLogged = true;
              console.log("[Multiplayer] ✓ first position tx verified on-chain:", sig.slice(0, 12));
            }
          }
          return;
        }
      }
      transactionLog.markFailed(entryId, "dropped, never landed on the rollup");
      console.warn("[Multiplayer] move tx dropped (no status after 5s):", sig.slice(0, 12));
      this.lastVerifyOkAt = 0; // unhealthy — verify the next move too
    } catch {
      // Status RPC unavailable — keep the optimistic confirm rather than
      // reporting a failure we haven't observed.
      transactionLog.markConfirmed(entryId, sig);
    } finally {
      this.moveVerifyBusy = false;
    }
  }

  /**
   * Calls connection.confirmTransaction only when `sig` is a real base58
   * transaction signature.  Simulation placeholders ("sim:*") are not valid
   * base58 — passing them to getSignatureStatus triggers a tweetnacl assert
   * ("Assertion failed") that escapes the surrounding try/catch and crashes
   * the ErrorBoundary.
   */
  private async confirmReal(
    connection: Connection,
    sig: string,
    commitment: "confirmed" | "finalized" = "confirmed",
  ): Promise<void> {
    if (sig.startsWith("sim:")) return;
    await connection.confirmTransaction(sig, commitment);
  }

  private async initializePlayerPDA(wallet: PublicKey, displayName: string): Promise<void> {
    const [pda] = derivePlayerPDA(wallet);
    const existing = await this.baseConnection.getAccountInfo(pda);
    if (existing) return; // already initialized — nothing to do

    const entry = transactionLog.record({
      kind: "init", layer: "base",
      label: "Initialize player PDA", status: "pending",
    });

    try {
      const ix = buildInitializePlayerIx(wallet, displayName.slice(0, 20));
      const { blockhash } = await this.baseConnection.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(ix);

      const sig = await this.signAndSendViaWallet(tx);
      await this.confirmReal(this.baseConnection, sig);
      transactionLog.markConfirmed(entry.id, sig);
    } catch (err: any) {
      console.error("[Multiplayer] PDA init failed:", err);
      transactionLog.markFailed(entry.id, err?.message ?? "init failed");
      throw err;
    }
  }

  /**
   * Reads session_authority from a raw PlayerState buffer.
   * Layout: 8-byte discriminator + 32-byte authority + Option<Pubkey>
   * (1-byte tag at offset 40, 32-byte key at 41 when tag = 1).
   */
  private readSessionAuthority(data: Buffer | Uint8Array): PublicKey | null {
    const buf = Buffer.from(data);
    if (buf.length < 8 + 32 + 33) return null;
    if (buf.readUInt8(40) !== 1) return null;
    return new PublicKey(buf.slice(41, 73));
  }

  /**
   * Ensures the ER's copy of the player PDA authorizes the CURRENT session
   * key. While delegated, that copy is the authoritative session state:
   * the base account is owned by the delegation program (unwritable by our
   * program), so the fix has to run on the rollup itself — ER blockhash,
   * wallet signs locally (sign-only bridge), sent to the ER endpoint.
   */
  private async syncSessionKeyOnEr(wallet: PublicKey, playerPDA: PublicKey): Promise<void> {
    const sessionKey = this.sessionKeys.getSessionPublicKey();

    let erSession: PublicKey | null = null;
    try {
      const info = await OnChainMultiplayer.withTimeout(
        this.ephemeralConnection.getAccountInfo(playerPDA), 5_000
      );
      erSession = info ? this.readSessionAuthority(info.data) : null;
    } catch (e: any) {
      console.warn("○ ER PDA read failed:", e?.message);
    }

    if (erSession && erSession.equals(sessionKey)) {
      this.sessionKeys["authorized"] = true;
      console.log("✓ ER session key in sync — no prompt needed");
      return;
    }

    console.log(
      `… ER session key ${erSession ? `stale (${erSession.toBase58().slice(0, 8)}… on ER)` : "unreadable"}` +
      " — re-authorizing on the rollup (1 sign prompt)"
    );
    this.progress("Re-authorizing on rollup (sign)…");
    const ix = buildAuthorizeSessionIx(wallet, sessionKey);
    const { blockhash } = await OnChainMultiplayer.withTimeout(
      this.ephemeralConnection.getLatestBlockhash(), 5_000
    );
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(ix);
    const signed = await this.requestWalletSignOnly(tx);
    const sig = await this.ephemeralConnection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
    });

    // Verify it landed — a silent drop here would leave every subsequent
    // move failing with InvalidSessionKey again.
    for (const delayMs of [800, 1500, 3000]) {
      await new Promise(r => setTimeout(r, delayMs));
      const st = await this.ephemeralConnection.getSignatureStatuses([sig]);
      const s = st?.value?.[0];
      if (s) {
        if (s.err) throw new Error(`ER authorize failed: ${JSON.stringify(s.err)}`);
        this.sessionKeys["authorized"] = true;
        console.log("✓ session key re-authorized on ER:", sig.slice(0, 12));
        return;
      }
    }
    throw new Error("ER authorize dropped, no status after 5s");
  }

  /**
   * Delegates the player PDA to the ER. Returns true once the delegation is
   * confirmed on-chain (its delegation record exists) — getSignatureStatuses on
   * the router is unreliable, so a delegated PDA is proven by the record.
   */
  private async delegateToEphemeral(wallet: PublicKey): Promise<boolean> {
    const [playerPDA] = derivePlayerPDA(wallet);
    const entry = transactionLog.record({
      kind: "delegate", layer: "base",
      label: "Delegate PDA → Ephemeral Rollup", status: "pending",
    });
    try {
      // The snapshot the wardrobe is checked against, refreshed while both
      // accounts are still writable in the same place. UnlockState is never
      // delegated and a delegated player PDA can only be written on the
      // rollup, so base-before-delegate is the last chance. An unlock earned
      // after this moment is not wearable until the next delegation.
      await this.syncUnlocksOnBase(wallet);

      // The NEAREST rollup, not a fixed one. This is the only moment the
      // choice is free: it is written into the delegation record, and moving
      // it afterwards means undelegating first.
      //
      // Everybody used to land on the same rollup, so two players in the same
      // room sent every update to the other side of the world and read it
      // back. The shared world does not need them together: every routine
      // write touches only the sender's own PDA, and the readers ask all the
      // rollups.
      const near = nearestValidator();
      const ix = buildDelegateIx(wallet, new PublicKey(near.identity));
      console.log(`[Multiplayer] delegating to ${near.label} (${near.rpc})`);
      const { blockhash } = await this.baseRpcWithRetry(() => this.baseConnection.getLatestBlockhash());
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(ix);

      const sig = await this.signAndSendViaWallet(tx);
      // Write where we just delegated. The sweep would find it anyway, but not
      // for a few seconds, and every position written to the wrong rollup in
      // between is simply lost.
      const nearConn = this.erReadConnections.find(r => r.id === near.id);
      if (nearConn) {
        this.ephemeralConnection = nearConn.conn;
        // Ours, not the sweep's, until the sweep has had time to see it.
        this.writeTargetPinnedUntil = Date.now() + 30_000;
      }
      const landed = await this.waitForDelegation(playerPDA, 12, 800);
      if (landed) {
        transactionLog.markConfirmed(entry.id, sig);
        console.log("[Multiplayer] PDA delegated to ephemeral rollup:", sig.slice(0, 12));
        return true;
      }
      transactionLog.markFailed(entry.id, "delegation record not found after send");
      return false;
    } catch (err: any) {
      console.error("[Multiplayer] delegate failed:", err);
      transactionLog.markFailed(entry.id, err?.message ?? "delegate failed");
      return false;
    }
  }

  /**
   * Polls the delegation record until it appears (PDA is delegated) or the
   * attempts run out. Tolerates the router's post-delegate propagation lag.
   */
  private async waitForDelegation(
    playerPDA: PublicKey, attempts: number, delayMs: number,
  ): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      if (await this.isPdaDelegated(playerPDA)) return true;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return this.isPdaDelegated(playerPDA);
  }

  /**
   * Polls until an account exists on base (via the router). Used to confirm
   * initialize_player actually landed — the router's WS confirm is unreliable,
   * and account existence is the ground truth we actually care about.
   */
  private async waitForAccount(
    pubkey: PublicKey, attempts: number, delayMs: number,
  ): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      try {
        const info = await this.baseConnection.getAccountInfo(pubkey);
        if (info !== null) return true;
      } catch { /* transient — keep polling */ }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      return (await this.baseConnection.getAccountInfo(pubkey)) !== null;
    } catch { return false; }
  }

  /**
   * Commits the delegated player PDA back to the base layer and undelegates it.
   * Called on disconnect. Signed by the session key (no wallet popup).
   */
  /**
   * Until when the sweep must not move our writes.
   *
   * Set when we delegate. The sweep decides where to write from where it last
   * SAW the account, and a rollup it has not swept yet looks exactly like a
   * rollup the account is not on - so right after delegating, its answer is
   * stale and wrong, and it would drag writes back to the rollup we just left.
   */
  private writeTargetPinnedUntil = 0;

  /**
   * Finds which rollup actually holds our PDA and writes there.
   *
   * Called when the chain says "InvalidWritableAccount", which is a rollup
   * telling us the account is not delegated to it. That is the authoritative
   * answer and it is worth more than anything this client can predict: a
   * delegation can be moved, can still be settling, or can have been made by
   * another device entirely.
   *
   * Debounced, because every move in flight fails at once and they would all
   * ask.
   */
  private relocating = false;
  private async relocateWrites(): Promise<void> {
    if (this.relocating || !this.wallet) return;
    this.relocating = true;
    try {
      await this.pointWritesAtOwningValidator(derivePlayerPDA(this.wallet)[0]);
    } finally {
      this.relocating = false;
    }
  }

  /**
   * Sends our writes to the rollup the account is actually delegated to.
   *
   * The delegation RECORD names that validator, and it is the only thing that
   * does. Asking the rollups which of them holds the account does not work:
   * measured 2026-10-26, all three answered yes for the same PDA. A rollup
   * keeps a copy of an account it has cloned, and a copy is not authority -
   * only one validator will accept a write, and the rest answer
   * InvalidWritableAccount.
   *
   * That is the bug this replaces. The city defaulted to the US rollup while
   * the account was delegated to Asia, so every move failed, and a fallback
   * that looked for "the rollup that has it" picked whichever answered first
   * and kept failing.
   *
   * Record layout, same as the SDK's own resolver: owned by the delegation
   * program, non-zero lamports, and the validator in bytes 8 to 40.
   */
  private async pointWritesAtOwningValidator(pda: PublicKey): Promise<void> {
    try {
      const record = delegationRecordPdaFromDelegatedAccount(pda);
      const info = await this.baseRpcWithRetry(
        () => this.baseConnection.getAccountInfo(record),
      );
      const delegated = info !== null
        && info.owner.equals(DELEGATION_PROGRAM_ID)
        && info.lamports !== 0;
      if (!delegated) {
        // Come home, or never delegated. Base is where it is writable, and
        // the next connect delegates it again.
        console.warn("[Multiplayer] the PDA is not delegated — writing to base");
        this.useEphemeral = false;
        return;
      }
      const validator = new PublicKey(info!.data.subarray(8, 40)).toBase58();
      const target = ER_VALIDATORS.find((v) => v.identity === validator);
      if (!target) {
        console.warn(`[Multiplayer] delegated to a rollup we do not read: ${validator}`);
        return;
      }
      const conn = this.erReadConnections.find((r) => r.id === target.id);
      if (!conn) return;
      this.useEphemeral = true;
      if (conn.conn !== this.ephemeralConnection) {
        this.ephemeralConnection = conn.conn;
        console.log(`[Multiplayer] writes go to ${target.label}, which holds the delegation`);
      }
    } catch (err: any) {
      console.warn("[Multiplayer] could not read the delegation record:", err?.message);
    }
  }

  /** Whether an account exists on base, without throwing. */
  private async accountExists(key: PublicKey): Promise<boolean> {
    try {
      return (await this.baseRpcWithRetry(() => this.baseConnection.getAccountInfo(key))) !== null;
    } catch {
      // Unreachable RPC. Answering "it exists" is the safe wrong answer: the
      // worst case is a missing unlock account, which the next connect
      // creates, against a duplicate init that fails the whole transaction
      // and leaves the player with no PDA at all.
      return true;
    }
  }

  /**
   * Copies UnlockState into the player's wardrobe snapshot, on base.
   *
   * Session-signed, so no popup. Failure is not fatal and not retried here:
   * the snapshot is only consulted when a loadout is written, the worst case
   * is wearing last session's unlocks, and the next connect syncs again.
   */
  private async syncUnlocksOnBase(wallet: PublicKey): Promise<void> {
    try {
      // ONE fetch, two jobs. The account is read here anyway to decide
      // whether there is anything to sync, so the same bytes also feed the
      // client's idea of what this wallet owns. Without this second job the
      // program enforces a snapshot the client has never seen, which is
      // exactly how an outfit write starts failing for someone who is
      // wearing something they genuinely own.
      const info = await this.baseRpcWithRetry(
        () => this.baseConnection.getAccountInfo(deriveUnlockPDA(wallet)[0]),
      );
      setOnChainUnlocks(wallet.toBase58(), info ? new Uint8Array(info.data) : null);
      if (!info) return;
      const sessionKey = this.sessionKeys.getSessionPublicKey();
      const { blockhash } = await this.baseRpcWithRetry(
        () => this.baseConnection.getLatestBlockhash(),
      );
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: sessionKey })
        .add(buildSyncUnlocksIx(wallet, sessionKey));
      this.sessionKeys.signTransaction(tx);
      const sig = await this.baseRpcWithRetry(
        () => this.baseConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true }),
      );
      console.log(`[Multiplayer] unlocks synced to the wardrobe snapshot: ${sig.slice(0, 12)}`);
    } catch (err: any) {
      console.warn("[Multiplayer] sync_unlocks skipped:", err?.message);
    }
  }

  private async commitAndUndelegatePlayer(wallet: PublicKey): Promise<void> {
    const entry = transactionLog.record({
      kind: "undelegate", layer: "ephemeral",
      label: "Commit & undelegate session", status: "pending",
    });
    try {
      const [playerPDA] = derivePlayerPDA(wallet);
      const sessionKey = this.sessionKeys.getSessionPublicKey();

      // OUR instruction, not the SDK's top-level one. The magic program
      // refuses a commit unless the account's OWNER invoked it by CPI, so
      // createCommitAndUndelegateInstruction fails with "failed to find
      // parent program id" however it is signed. It had been failing into a
      // catch since the beginning, which is why PDAs pile up delegated and
      // why the base copy of a player is frozen at spawn forever.
      const ix = buildCommitAndUndelegatePlayerSessionIx(wallet, sessionKey);
      void playerPDA;
      const { blockhash } = await this.ephemeralConnection.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: sessionKey }).add(ix);

      // Session key signs — no wallet popup required
      this.sessionKeys.signTransaction(tx);
      const sig = await this.ephemeralConnection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      transactionLog.markConfirmed(entry.id, sig);
      console.log("[Multiplayer] committed & undelegated:", sig.slice(0, 12));
      // Do NOT rotate the session key. Rotating meant the NEXT connect signed
      // moves with a fresh key while the ER copy still held the old one (the
      // undelegate is async) → InvalidSessionKey (6000) on every move, so that
      // device's writes never landed and it stayed invisible to peers. Keeping
      // ONE stable key means it already matches (or a single re-authorize syncs
      // it), and moves land — restoring two-way visibility.
    } catch (err: any) {
      transactionLog.markFailed(entry.id, err?.message ?? "undelegate failed");
    }
  }

  // ── Account data decoder ──────────────────────────────────────────────

  /**
   * Decodes a raw PlayerState account buffer (without pulling in Anchor).
   *
   * Layout (little-endian) after the 8-byte discriminator:
   *   [32]  authority         Pubkey
   *   [33]  session_authority Option<Pubkey> (1-byte tag + 32 bytes if Some)
   *   [4+n] display_name      String (4-byte length prefix + n UTF-8 bytes, max 20)
   *   [4]   x                 u32
   *   [4]   y                 u32
   *   [1]   direction         u8
   *   [1]   outfit_id         u8
   *   [4]   score             u32
   *   [2]   swap_count        u16
   *   [2]   transfer_count    u16
   *   [2]   bounty_count      u16
   *   [8]   last_active       i64
   *   [8]   created_at        i64
   *
   * We read authority, x, y, direction, display_name and score for the multiplayer view.
   */
  /**
   * `slot` is the rollup slot the data was read at. Reads that carry one (poll,
   * websocket) are applied only if not older than the last one applied. The
   * roster refresh passes none: it reads at "confirmed", which trails the live
   * "processed" reads, so it may ADD a player but never moves a known one.
   */
  private decodeAndUpdatePlayer(pda: string, data: Buffer | Uint8Array, slot?: number, fromPush = false): void {
    try {
      const buf = Buffer.from(data);
      if (buf.length < 83) return; // 8 + 32 + 33 + 4 + 4 + 4 (min)

      // The ER's getProgramAccounts hands back every account ever delegated to
      // the rollup, not the players currently in the city — observed 27 of them
      // with two people actually online. The other 25 are frozen: identical
      // bytes every five seconds, parsed in full (two base58 encodes among
      // them) only to be dropped by the freshness gate further down.
      //
      // Deliberately scoped to the discovery sweep, which is the only caller
      // that passes no slot. The 500ms poll and the websocket push both carry
      // one, and skipping those would leave lastSlot behind and weaken the
      // out-of-order guard that depends on it.
      if (slot === undefined) {
        const seen = this.lastDiscoveryBytes.get(pda);
        if (seen && seen.length === buf.length && buf.equals(seen)) return;
        this.lastDiscoveryBytes.set(pda, Buffer.from(buf));
      }

      let offset = 8; // skip 8-byte Anchor discriminator

      // authority (32 bytes) — main wallet address
      const authority = new PublicKey(buf.slice(offset, offset + 32));
      const walletStr = authority.toBase58();
      offset += 32;

      // session_authority: Option<Pubkey> — 1 tag byte + 32 if tag=1
      const hasSession = buf.readUInt8(offset) === 1;
      if (hasSession) {
        // Kept, not skipped: this is the only place the two keys appear
        // together, and the hunt needs it to name a winner.
        this.sessionToWallet.set(
          new PublicKey(buf.subarray(offset + 1, offset + 33)).toBase58(),
          walletStr,
        );
      }
      offset += 1 + (hasSession ? 32 : 0);

      // Our own account arrives in every ER getProgramAccounts page (the PDA
      // poll filters self, the discovery sweep cannot), and the whole parse
      // below was being thrown away at the end. Bail here instead: this is the
      // earliest point where it is safe, because the session->wallet line above
      // is the one thing we do need from our own record.
      if (walletStr === this.wallet?.toBase58()) return;

      // display_name: 4-byte length + UTF-8 string (max 20 bytes)
      const nameLen = Math.min(buf.readUInt32LE(offset), 20);
      offset += 4;
      const displayName = buf.slice(offset, offset + nameLen).toString("utf-8");
      offset += nameLen;

      // x, y (u32 each)
      const x = buf.readUInt32LE(offset); offset += 4;
      const y = buf.readUInt32LE(offset); offset += 4;

      // direction (u8)
      const rawDirection = buf.readUInt8(offset); offset += 1;
      const direction = rawDirection & DIR_MASK;
      const walkFlag = (rawDirection & DIR_HAS_WALK_FLAG) !== 0
        ? (rawDirection & DIR_WALKING) !== 0
        : undefined;
      const buffIndex = (rawDirection & DIR_SPEED_BUFF) === 0
        ? null
        : ((rawDirection & DIR_BUFF_KIND) !== 0 ? 1 : 0);

      // Skip outfit_id; read score (the card another player opens on this one
      // shows it); skip swap_count, transfer_count, bounty_count.
      offset += 1;
      const score = buf.readUInt32LE(offset);
      offset += 4 + 2 + 2 + 2;

      // last_active (i64 — read lower 4 bytes; fits in u32 until year 2106)
      const lastActiveLo = buf.readUInt32LE(offset);
      const lastActiveMs = lastActiveLo * 1000; // on-chain Unix seconds → ms

      // ── v2 shared-world fields (appended after created_at): loadout, expression
      //    + expression_at, last_message + message_at. Parsed defensively so old
      //    v1 accounts (no fields, shorter buffer) decode fine as empty/0.
      offset += 8; // rest of last_active (i64)
      offset += 8; // created_at (i64)
      const readStr = (): string => {
        if (offset + 4 > buf.length) { offset = buf.length + 1; return ""; }
        const len = buf.readUInt32LE(offset); offset += 4;
        if (len > 4096 || offset + len > buf.length) { offset = buf.length + 1; return ""; }
        const s = buf.slice(offset, offset + len).toString("utf-8"); offset += len; return s;
      };
      const readTsLo = (): number => {
        if (offset + 8 > buf.length) { offset = buf.length + 1; return 0; }
        const v = buf.readUInt32LE(offset); offset += 8; return v;
      };
      const loadoutStr   = readStr();
      const expression   = readStr();
      const expressionAt = readTsLo();
      const lastMessage  = readStr();
      const messageAt    = readTsLo();

      // -- v3 fields: the unlock snapshot, then the public profile -----------
      // Read defensively like the v2 block above, so a v2 account (shorter
      // buffer, these fields absent) still decodes as a player with no
      // achievements rather than failing the whole parse.
      const readBytes = (n: number): Buffer | null => {
        if (offset + n > buf.length) { offset = buf.length + 1; return null; }
        const out = buf.subarray(offset, offset + n); offset += n; return out;
      };
      const readU16 = (): number => {
        if (offset + 2 > buf.length) { offset = buf.length + 1; return 0; }
        const v = buf.readUInt16LE(offset); offset += 2; return v;
      };
      // The unlock snapshot used to sit HERE, between message_at and the
      // profile, and had to be skipped by exactly its own length or every
      // field after it decoded from the wrong offset. It now lives at the end
      // of the account, after game_bests, so nothing here has to know its
      // size and the sweep below never fetches it at all.
      const achievementBits = readBytes(ACHIEVEMENT_BITS);
      const streakCurrent = readU16();
      const streakBest    = readU16();
      // game_bests: [u32; 16]. Absent on a v2 account, which readBytes
      // reports as null rather than reading past the end.
      const bestsRaw = readBytes(GAME_SLOT_CAP * 4);
      const gameBests = bestsRaw
        ? Array.from({ length: GAME_SLOT_CAP }, (_, i) => bestsRaw.readUInt32LE(i * 4))
        : null;

      // (self already returned above, right after the session->wallet line)

      // Watching last_active move forward dates the device clock against the
      // chain: this write is happening now on both. It has to be the SAME
      // account advancing between two sightings — a first sighting proves
      // nothing, since it may be a ghost that stopped writing weeks ago, and
      // learning "skew" from one made every ghost look alive (a 14-day "skew"
      // was measured exactly that way). Only a gross difference counts as
      // skew; small ones are ordinary propagation delay.
      const prevTs = this.lastSeenTs.get(walletStr);
      this.lastSeenTs.set(walletStr, lastActiveLo);
      if (prevTs !== undefined && lastActiveLo > prevTs) {
        const skew = Date.now() - lastActiveLo * 1000;
        const next = Math.abs(skew) > 60_000 ? skew : 0;
        if (next !== 0 && Math.abs(next - this.clockSkewMs) > 60_000) {
          console.warn(`[Multiplayer] device clock is ${Math.round(skew / 1000)}s off chain time — correcting`);
        }
        this.clockSkewMs = next;
      }
      const now = Date.now();
      // Device time, shifted onto the chain's clock — the only timeline an
      // on-chain timestamp can be compared against.
      const chainNow = now - this.clockSkewMs;

      // Freshness gate — surface only accounts active recently. A delegated PDA
      // whose owner closed the tab without undelegating stays on the ER forever
      // with a months-old last_active (the "9592…/7q8m…" ghosts); and a player
      // standing still stops writing position. Both are filtered here on EVERY
      // sighting (not just when already known), so ghosts never enter the city
      // and idle players are dropped. A player who moves writes a fresh
      // last_active and passes the gate again — no block map needed.
      const IDLE_TIMEOUT_MS = 120_000; // 2 min of on-chain inactivity
      const isKnown = this.knownPlayers.has(walletStr);
      if (chainNow - lastActiveMs > IDLE_TIMEOUT_MS) {
        if (isKnown) {
          console.log(`[Multiplayer] dropping idle/stale ${walletStr.slice(0,8)} (${Math.round((chainNow - lastActiveMs) / 60_000)}min inactive)`);
          this.handlePlayerLeave(walletStr);
        }
        return;
      }

      // Only update if this data is newer than what we have.
      const existing = this.knownPlayers.get(walletStr);
      if (existing) {
        if (slot === undefined) return; // roster refresh — never moves a known player
        const lastSlot = this.lastSlot.get(walletStr);
        if (lastSlot !== undefined && slot < lastSlot) return; // arrived out of order
      }
      if (slot !== undefined) this.lastSlot.set(walletStr, slot);
      const onChainTs = lastActiveLo; // u32 unix seconds
      if (existing && (existing as any)._onChainTs !== undefined) {
        if (onChainTs < (existing as any)._onChainTs) return; // stale — skip
      }

      const wasKnown = existing !== undefined;
      const moved = existing !== undefined && (x !== existing.x || y !== existing.y);
      const isWalking = walkFlag ?? moved;
      if (existing && !moved && existing.direction === direction && existing.walkFlag === walkFlag
          && (existing.buffIndex ?? null) === buffIndex) {
        // The same state again — every write now arrives twice (websocket
        // push, then the poll). Passing it on as a "move" told the scene the
        // player had stopped, and their legs froze until the next sample.
        existing.lastUpdate = Date.now();
      } else {
        this.handlePlayerMove(walletStr, x, y, direction, isWalking, displayName, undefined, walkFlag, buffIndex);
        if (slot !== undefined) this.noteRead(fromPush);
      }
      const updated = this.knownPlayers.get(walletStr);
      if (updated) {
        (updated as any)._onChainTs = onChainTs;
        updated.score = score;

        // Loadout — apply on first sight AND on change (it's a persistent field).
        if (loadoutStr && loadoutStr !== (updated as any)._loadoutStr) {
          (updated as any)._loadoutStr = loadoutStr;
          updated.loadout = decodeLoadout(loadoutStr);
          for (const cb of this.changeCallbacks) cb(walletStr, updated);
        }

        // The public profile — persistent fields too, so first sight AND
        // change, same as the loadout. Compared as raw bytes because the
        // decoded Set would allocate on every poll just to find out nothing
        // moved, and this runs for every player twice a second.
        if (achievementBits) {
          const sig = achievementBits.toString("base64");
          if (sig !== (updated as any)._achSig) {
            (updated as any)._achSig = sig;
            updated.achievements = achievementIndices(achievementBits);
          }
        }
        if (streakCurrent !== updated.streakCurrent || streakBest !== updated.streakBest) {
          updated.streakCurrent = streakCurrent;
          updated.streakBest = streakBest;
        }
        // Compared as a joined string for the same reason the achievement
        // bits are compared as base64: this runs for every player twice a
        // second and allocating sixteen numbers to discover nothing moved is
        // the kind of per-frame waste that put the city at 95% CPU once.
        if (gameBests) {
          const sig = gameBests.join(",");
          if (sig !== (updated as any)._bestsSig) {
            (updated as any)._bestsSig = sig;
            updated.gameBests = gameBests;
          }
        }

        // A kick of the beach football rides the chat field, tagged (see
        // world/BeachBall). It is deduped by the PAYLOAD, not by message_at:
        // that stamp is in whole SECONDS and a dribble puts three kicks inside
        // one of them, so a timestamp gate would silently eat two of every
        // three touches. The sequence number in the tag makes even an
        // identical kick a different string.
        const ballTag = lastMessage && lastMessage.startsWith(BALL_TAG) ? lastMessage : null;
        const bus = (globalThis as any).__solCityGameEvents;

        // Expression + chat — fired only on a genuine change, never replayed on
        // first sight (so joining doesn't replay someone's stale expression/msg).
        if (!wasKnown) {
          (updated as any)._exprAt = expressionAt;
          (updated as any)._msgAt = messageAt;
          // The ball is the exception. The last touch the city remembers is
          // the only record of where the ball actually IS, so a player walking
          // in takes it rather than starting on a ball nobody else can see.
          // BeachBall ignores it once any live kick has arrived.
          if (ballTag) {
            const kick = decodeBallKick(ballTag);
            if (kick) bus?.emit("ball:kick", { kick, stale: true, staleAt: messageAt });
          }
        } else {
          // Expression is its own field and its own stamp, so it is read
          // whatever the message field happens to be carrying.
          if (expression && expressionAt > ((updated as any)._exprAt ?? 0)) {
            (updated as any)._exprAt = expressionAt;
            for (const cb of this.exprCallbacks) cb(walletStr, expression);
          }
          if (ballTag) {
            if (ballTag !== (updated as any)._ballTag) {
              const kick = decodeBallKick(ballTag);
              if (kick) bus?.emit("ball:kick", { kick, stale: false });
            }
          } else if (lastMessage && messageAt > ((updated as any)._msgAt ?? 0)) {
            (updated as any)._msgAt = messageAt;
            bus?.emit("chat:network", {
              wallet: walletStr,
              name: updated.displayName ?? walletStr.slice(0, 8),
              text: lastMessage,
            });
          }
        }
        // Remembered either way, so kicking, then talking, then repeating the
        // very same kick still reads as a new one.
        (updated as any)._ballTag = ballTag;
      }
    } catch {
      // Corrupt or unrecognized account — skip silently
    }
  }

  // ── Position transaction (Magic Router) ──────────────────────────────

  // Helper: race a promise against a timeout so a hanging RPC call never
  // blocks position updates indefinitely (was causing "pending forever" bug).
  private static withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("rpc timeout")), ms)
      ),
    ]);
  }

  /**
   * Cached recent blockhash for move txs. Moves fire at 2/s and fetching a
   * fresh blockhash per tx doubled RPC volume on the move path — which is
   * what pushed the endpoints into rate limiting and made sends time out.
   * Validity margins: ER blocks are ~50ms so 150 blocks ≈ 7.5s (cache 3s);
   * base layer blockhashes live ~60s+ (cache 20s). If a cached hash ever
   * expires early the tx is dropped and the status verifier flags it.
   */
  private cachedMoveBlockhash: { hash: string; fetchedAt: number; layer: "ephemeral" | "base" } | null = null;

  /**
   * Refreshes the cached blockhash in the background while the player is
   * actively moving, so sendPositionTransaction always finds a warm one.
   * Idle players skip it: no moves, no reason to spend the request.
   */
  private prefetchMoveBlockhash(): void {
    if (!this._connected || !isProgramDeployed()) return;
    if (Date.now() - this.lastPosSent > 10_000) return; // idle — heartbeat can pay the trip
    const layer = this.useEphemeral ? "ephemeral" : "base";
    const cached = this.cachedMoveBlockhash;
    const ttlMs = layer === "ephemeral" ? 2_000 : 20_000;
    // Refresh a little before it goes stale, never on top of a fresh one.
    if (cached && cached.layer === layer && Date.now() - cached.fetchedAt < ttlMs * 0.6) return;
    this.getMoveBlockhash(layer).catch(() => { /* next tick retries */ });
  }

  private async getMoveBlockhash(layer: "ephemeral" | "base"): Promise<string> {
    // Shorter TTL on the ER: its blockhash validity window is tight, and a
    // slightly stale cached hash was the dominant cause of dropped ("null
    // signature") moves during movement bursts. 2s keeps enough reuse to batch.
    const ttlMs = layer === "ephemeral" ? 2_000 : 20_000;
    const now = Date.now();
    const cached = this.cachedMoveBlockhash;
    if (cached && cached.layer === layer && now - cached.fetchedAt < ttlMs) {
      return cached.hash;
    }
    const conn = layer === "ephemeral" ? this.ephemeralConnection : this.baseConnection;
    const { blockhash } = await OnChainMultiplayer.withTimeout(conn.getLatestBlockhash(), 5_000);
    this.cachedMoveBlockhash = { hash: blockhash, fetchedAt: now, layer };
    return blockhash;
  }

  private async sendPositionTransaction(x: number, y: number, direction: number): Promise<string | null> {
    if (!this.wallet) return null;

    const sessionKey = this.sessionKeys.getSessionPublicKey();
    const ix = buildUpdatePositionSessionIx(
      this.wallet, sessionKey,
      Math.round(x), Math.round(y), direction,
    );

    if (this.useEphemeral) {
      // Direct path to ephemeral RPC — returns a real ER tx hash. A single
      // retry with a FRESH blockhash covers the dominant failure ("null
      // signature"): the 3s-cached ER blockhash occasionally expires between
      // reuse, so the first send throws — the retry rebuilds+re-signs against a
      // new hash instead of dropping the move outright.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) this.cachedMoveBlockhash = null; // force a fresh hash on each retry
          const tx = new Transaction().add(ix);
          tx.feePayer = sessionKey;
          // Was the hash already in hand, or did this send have to go and ask
          // for one? A cold hash doubles the round trips, and a move that
          // reports twice the latency of the network is usually this rather
          // than the network.
          const hashWasCold = !this.cachedMoveBlockhash;
          tx.recentBlockhash = await this.getMoveBlockhash("ephemeral");
          if (hashWasCold || attempt > 0) this.noteMoveCost(attempt, hashWasCold);
          this.sessionKeys.signTransaction(tx);
          // Actual execution outcome is verified by trackMoveConfirmation
          // (sampled getSignatureStatuses) in the caller.
          return await OnChainMultiplayer.withTimeout(
            this.ephemeralConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true }),
            6_000,
          );
        } catch (err: any) {
          // Don't permanently disable ER — rate limits and transient errors clear up.
          this.cachedMoveBlockhash = null;
          if (attempt === 2) {
            console.warn("[Multiplayer] ephemeral tx skipped:", err?.message);
            return null;
          }
        }
      }
      return null;
    }

    // Base layer path — only used when the PDA is genuinely NOT delegated.
    // (A delegated PDA is forced onto the ER path above, since a base write to
    // it always fails with AccountOwnedByWrongProgram / custom 3007.)
    try {
      const tx = new Transaction().add(ix);
      tx.feePayer = sessionKey;
      tx.recentBlockhash = await this.getMoveBlockhash("base");
      this.sessionKeys.signTransaction(tx);
      return await OnChainMultiplayer.withTimeout(
        this.baseConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true }),
        6_000,
      );
    } catch (err) {
      this.cachedMoveBlockhash = null;
      throw err;
    }
  }

  /**
   * Sends a session-key-signed instruction to the player's delegated PDA on
   * the ER (base fallback if not delegated) — used for the low-frequency
   * shared-world writes (loadout / expression / chat). Same seamless path as
   * position, fire-and-forget, one fresh-blockhash retry.
   */
  private async sendSessionIx(
    ix: TransactionInstruction,
    log?: { kind: "outfit" | "chat" | "expression" | "ball" | "profile"; label: string },
  ): Promise<void> {
    if (!this.wallet || !isProgramDeployed()) return;
    const sessionKey = this.sessionKeys.getSessionPublicKey();

    // Ask the chain before writing on base, rather than trusting a flag that
    // may not be set yet.
    //
    // useEphemeral starts false and is only decided part-way through
    // startMagicBlockMultiplayer, which is async — while these writes have no
    // such gate. The profile publisher fires about a second and a half after
    // the scene mounts, and chat, expression and outfit writes can land
    // whenever the player acts. Any of them arriving before that decision went
    // to BASE, and a PDA that is already delegated (from this session or an
    // earlier one — delegation outlives the tab) can only be written on the
    // ER: the base write fails with AccountOwnedByWrongProgram, custom 3007.
    // That is the "transactions that write on delegated accounts" MagicBlock
    // reported seeing from us.
    //
    // The delegation record is read from base, where it always lives, so this
    // answer is authoritative. A true answer also repairs the flag, so the
    // lookup happens a handful of times at most; a false one is the genuine
    // not-delegated case and costs one extra read on a path that is rare by
    // construction.
    if (!this.useEphemeral) {
      try {
        if (await this.isPdaDelegated(derivePlayerPDA(this.wallet)[0])) {
          console.log("[Multiplayer] PDA is delegated — session write goes to the ER, not base");
          this.useEphemeral = true;
        }
      } catch { /* unreachable base RPC — fall through and let the send decide */ }
    }

    const conn = this.useEphemeral ? this.ephemeralConnection : this.baseConnection;
    const layer = this.useEphemeral ? "ephemeral" : "base";
    // Surface these ER writes in the ONCHAIN LOG too — each under its own kind
    // (outfit / expression / chat / ball) so they're independently filterable.
    const entry = log
      ? transactionLog.record({ kind: log.kind, layer, label: log.label, status: "pending" })
      : null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt === 1) this.cachedMoveBlockhash = null;
        const tx = new Transaction().add(ix);
        tx.feePayer = sessionKey;
        tx.recentBlockhash = await this.getMoveBlockhash(layer);
        this.sessionKeys.signTransaction(tx);
        const sig = await OnChainMultiplayer.withTimeout(
          conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }), 6_000,
        );
        if (entry) transactionLog.markConfirmed(entry.id, sig);
        return;
      } catch (err: any) {
        this.cachedMoveBlockhash = null;
        if (attempt === 1) {
          console.warn("[Multiplayer] session ix skipped:", err?.message);
          if (entry) transactionLog.markFailed(entry.id, err?.message ?? "not sent");
        }
      }
    }
  }

  // ── Wallet signing bridge ─────────────────────────────────────────────

  /**
   * Signs a base-layer tx with the wallet, then broadcasts it OURSELVES via the
   * app's devnet connection. We deliberately avoid the wallet's own
   * sign-AND-send: Phantom's `signAndSendTransaction` broadcasts on whatever
   * network the wallet is set to (mainnet by default), not on our connection —
   * so a devnet tx sent that way lands nowhere and throws "Unexpected error".
   * `signTransaction` is network-agnostic (it just signs the bytes, devnet
   * blockhash and all), so signing here + sending on baseConnection keeps every
   * wallet-signed tx on devnet regardless of the wallet's selected cluster.
   */
  private async signAndSendViaWallet(tx: Transaction): Promise<string> {
    const signed = await this.requestWalletSignOnly(tx);
    return this.baseConnection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
  }

  /**
   * Emits a game event asking React (which has access to useWallet()) to sign
   * a transaction. Returns the signature once confirmed.
   * This avoids passing wallet adapter hooks deep into Phaser scenes.
   */
  private requestWalletSign(tx: Transaction): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("wallet sign timeout")), 60_000);

      // Access the global game event bus — set by CityScene on connect.
      // IMPORTANT: do NOT resolve with a fake signature — passing non-base58
      // strings to confirmTransaction / getSignatureStatus triggers a tweetnacl
      // "Assertion failed" that escapes try/catch.  Reject instead so callers
      // fall through to their catch blocks and gracefully enter offline mode.
      const bus = (globalThis as any).__solCityGameEvents as Phaser.Events.EventEmitter | undefined;
      if (!bus) {
        clearTimeout(timeout);
        reject(new Error("wallet bus not available, session offline"));
        return;
      }

      bus.once("wallet:signedTx", (sig: string) => {
        clearTimeout(timeout);
        resolve(sig);
      });
      bus.once("wallet:signError", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
      bus.emit("wallet:needSign", tx);
    });
  }

  /**
   * Asks the wallet to SIGN a transaction without sending it — used when the
   * tx must be submitted to a different cluster than the app connection
   * (e.g. authorize_session on the ephemeral rollup). Returns the signed tx.
   */
  private requestWalletSignOnly(tx: Transaction): Promise<Transaction> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("wallet sign timeout")), 60_000);

      const bus = (globalThis as any).__solCityGameEvents as Phaser.Events.EventEmitter | undefined;
      if (!bus) {
        clearTimeout(timeout);
        reject(new Error("wallet bus not available, session offline"));
        return;
      }

      bus.once("wallet:signedTxOnly", (signed: Transaction) => {
        clearTimeout(timeout);
        resolve(signed);
      });
      bus.once("wallet:signOnlyError", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
      bus.emit("wallet:needSignOnly", tx);
    });
  }

  // ── Player state machine ──────────────────────────────────────────────

  private handlePlayerJoin(
    wallet: string, x: number, y: number, d: number, m: boolean,
    name?: string, score?: number, loadout?: Loadout,
  ): void {
    if (this.knownPlayers.has(wallet)) {
      this.handlePlayerMove(wallet, x, y, d, m, name, score);
      if (loadout) this.handleLook(wallet, loadout);
      return;
    }
    const player: OnChainPlayer = {
      wallet, x, y, direction: d, isWalking: m,
      lastUpdate: Date.now(), displayName: name, score,
      loadout: loadout ?? this.pendingLoadouts.get(wallet),
    };
    this.knownPlayers.set(wallet, player);
    this.pendingLoadouts.delete(wallet);
    for (const cb of this.addCallbacks) cb(wallet, player);
    this.subscribeToPlayerWallet(wallet);
    this.scheduleLookRebroadcast();
  }

  private handleLook(wallet: string, loadout: Loadout): void {
    if (wallet === this.wallet?.toBase58()) return;
    const player = this.knownPlayers.get(wallet);
    if (!player) {
      // Look arrived before we discovered this player — apply it on add.
      this.pendingLoadouts.set(wallet, loadout);
      return;
    }
    player.loadout = loadout;
    for (const cb of this.changeCallbacks) cb(wallet, player);
  }

  /**
   * No-op since the loadout lives in the ER PlayerState (a persistent field
   * others read off the poll). Late joiners see our outfit on their next poll,
   * so there's nothing to re-announce. Kept as a stub for its call sites.
   */
  private scheduleLookRebroadcast(): void {
    /* intentionally empty — see doc comment */
  }

  private handleExpr(wallet: string, textureKey: string): void {
    if (wallet === this.wallet?.toBase58()) return;
    for (const cb of this.exprCallbacks) cb(wallet, textureKey);
  }

  private handlePlayerMove(
    wallet: string, x: number, y: number, d: number, m: boolean,
    name?: string, score?: number, walkFlag?: boolean, buffIndex?: number | null,
  ): void {
    // Always use Date.now() for lastUpdate so polling keeps players visible
    // even when on-chain writes are temporarily failing (e.g. delegated PDAs).
    // Ghost removal is handled by the 2-min threshold in decodeAndUpdatePlayer.
    const lastUpdate = Date.now();

    let player = this.knownPlayers.get(wallet);
    if (!player) {
      const pend = this.pendingLoadouts.get(wallet);
      player = { wallet, x, y, direction: d, isWalking: m, walkFlag, buffIndex, lastUpdate, displayName: name, score, loadout: pend };
      this.knownPlayers.set(wallet, player);
      this.pendingLoadouts.delete(wallet);
      for (const cb of this.addCallbacks) cb(wallet, player);
      this.subscribeToPlayerWallet(wallet);
      this.scheduleLookRebroadcast(); // re-announce our look so the newcomer sees us
      return;
    }
    player.x = x; player.y = y; player.direction = d; player.isWalking = m; player.walkFlag = walkFlag;
    if (buffIndex !== undefined) player.buffIndex = buffIndex;
    player.lastUpdate = lastUpdate;
    if (name) player.displayName = name;
    if (score !== undefined) player.score = score;
    for (const cb of this.changeCallbacks) cb(wallet, player);
  }

  /**
   * Subscribes to a player's PDA ON THE ROLLUP, where their live copy is.
   *
   * This used to subscribe on base. The base copy of a delegated account is
   * frozen until it commits, so that subscription never delivered a single
   * position — every metre of movement you saw came from the 500ms poll, and
   * meanwhile each client held one idle websocket per player against the same
   * base RPC that the whole playtest was already rate-limiting.
   *
   * On the rollup the validator pushes each write as it executes, so a remote
   * step arrives about half a round trip after it happens instead of waiting
   * out the poll interval. The poll stays as the fallback (see
   * pollKnownPlayerPDAs) for anyone whose pushes are not arriving.
   */
  private subscribeToPlayerWallet(wallet: string): void {
    try {
      const walletPub = new PublicKey(wallet);
      const [pda] = derivePlayerPDA(walletPub);
      const key = pda.toBase58();
      if (this.accountSubs.has(key)) return;
      const subId = this.ephemeralConnection.onAccountChange(
        pda,
        (info, context) => this.decodeAndUpdatePlayer(key, info.data, context.slot, true),
        "processed",
      );
      this.accountSubs.set(key, subId);
    } catch { /* ignore invalid wallet */ }
  }

  /** Drops the rollup subscription for a player who left the city. */
  private unsubscribeFromPlayerWallet(wallet: string): void {
    try {
      const [pda] = derivePlayerPDA(new PublicKey(wallet));
      const key = pda.toBase58();
      const subId = this.accountSubs.get(key);
      if (subId === undefined) return;
      this.accountSubs.delete(key);
      this.ephemeralConnection.removeAccountChangeListener(subId).catch(() => {});
    } catch { /* ignore invalid wallet */ }
  }

  private handlePlayerLeave(wallet: string): void {
    this.lastSlot.delete(wallet);
    // Unsubscribe even for an unknown wallet: leaving is also how a ghost is
    // pruned, and a leaked subscription per prune is what exhausts the socket.
    this.unsubscribeFromPlayerWallet(wallet);
    if (!this.knownPlayers.has(wallet)) return;
    this.knownPlayers.delete(wallet);
    for (const cb of this.removeCallbacks) cb(wallet);
  }

  private pruneStale(): void {
    const cutoff = Date.now() - 300_000; // 5 min — generous window for unreliable writes
    for (const [wallet, player] of this.knownPlayers) {
      if (wallet === this.wallet?.toBase58()) continue;
      if (player.lastUpdate < cutoff) this.handlePlayerLeave(wallet);
    }
  }
}
