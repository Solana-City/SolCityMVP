"use client";

/**
 * The Donation Manager's panel.
 *
 * Four screens, in the order a donor meets them: the board and how to give
 * (home), what a donation is (about), how much (amount), and the thanks
 * (success). The one point it will not let a player miss is that this is a
 * donation to the team and not a purchase: the home screen says so under the
 * button that starts it, the about screen has a card for it, the amount screen
 * repeats it above the confirm button, and that button says "donate" and not
 * "buy".
 *
 * Nothing here grants anything. No item, no outfit, no advantage, no place in
 * any queue. The board is a thank you, and it is the whole reward.
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";

import { PanelTitleBar, ProtocolLogo } from "@/ui/PixelIcons";
import { CATEGORY_META } from "@/game/minimap/categories";
import { chamferBox } from "@/ui/chamfer";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";
import { transactionLog } from "@/game/telemetry/transactionLog";
import { getSendToken, explorerUrl } from "@/game/solana/sendTokens";
import { DONATION_WALLET, formatSol, shortWallet } from "@/lib/donationWallet";

const COMMUNITY = CATEGORY_META.community.color;
const WARN = "#FFD700";
const LIME = "#B7E928";
const PIX = '"Press Start 2P", monospace';

interface DonorRow {
  wallet: string;
  name: string | null;
  lamports: number;
  count: number;
  last: number;
}

interface Board {
  totalLamports: number;
  donorCount: number;
  rows: DonorRow[];
  stale: boolean;
}

type Screen = "home" | "about" | "amount";

// ── Pieces ──────────────────────────────────────────────────────────────────

/** The donation wallet as "FSej...UExm", the way it reads on a board. */
const SHORT_WALLET = `${DONATION_WALLET.slice(0, 4)}...${DONATION_WALLET.slice(-4)}`;

/** Copies the donation address; says so for a moment. */
function useCopyWallet() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard?.writeText(DONATION_WALLET)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
      .catch(() => {});
  }, []);
  return { copied, copy };
}

/** A pixel icon drawn on a 12x12 grid, as filled squares. */
function PixelIcon({ cells, size = 28, color = LIME }: { cells: string[]; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" style={{ display: "block", flexShrink: 0 }} aria-hidden>
      {cells.flatMap((row, y) => [...row].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={color} /> : null)))}
    </svg>
  );
}

const ICON_TEAM = [
  "....####....",
  "....####....",
  ".##.####.##.",
  ".##..##..##.",
  "####.##.####",
  "####.##.####",
  "####.##.####",
  "####....####",
  "............",
  "............",
  "............",
  "............",
];
const ICON_BAN = [
  "....####....",
  "..##....##..",
  ".#.......##.",
  ".#......#.#.",
  "#......#..##",
  "#.....#...##",
  "#....#....##",
  "#...#.....##",
  ".#.#.....#..",
  ".##.....##..",
  "..##....##..",
  "....####....",
];
const ICON_COINS = [
  "..######....",
  ".#......#...",
  ".########...",
  ".#......#...",
  ".########...",
  ".#......#...",
  ".########...",
  ".#......#...",
  ".########...",
  ".#......#...",
  "..######....",
  "............",
];
const ICON_CHART = [
  "............",
  "........##..",
  "........##..",
  "....##..##..",
  "....##..##..",
  "##..##..##..",
  "##..##..##..",
  "##..##..##..",
  "############.",
  "............",
  "............",
  "............",
];
const ICON_COPY = [
  "...#######..",
  "...#.....#..",
  "...#.....#..",
  "#######..#..",
  "#.....#..#..",
  "#.....######",
  "#.....#.....",
  "#.....#.....",
  "#######.....",
  "............",
  "............",
  "............",
];
const ICON_CHECK = [
  "....####....",
  "..##....##..",
  ".#........#.",
  ".#......#.#.",
  "#......##..#",
  "#.#...##...#",
  "#..#.##....#",
  "#...##.....#",
  ".#........#.",
  ".#........#.",
  "..##....##..",
  "....####....",
];

/**
 * The "? About donations" button on a title row. `short` drops the words
 * "donations", for a row that also carries the Mainnet badge and would
 * otherwise cut the title off.
 */
function AboutButton({ onClick, short = false }: { onClick: () => void; short?: boolean }) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick}
      {...feel.handlers}
      style={chamferBox(6, {
        display: "flex", alignItems: "center", gap: 6, padding: "6px 9px",
        background: "transparent", color: COMMUNITY,
        border: `1px solid ${COMMUNITY}`, cursor: "pointer",
        fontFamily: PIX, fontSize: 8, whiteSpace: "nowrap",
        ...feelStyle(feel),
      })}
    >
      <span style={{ fontSize: 9 }}>?</span>{short ? "About" : "About donations"}
    </button>
  );
}

/** A full-width action button. `kind` picks the solid cyan or the quiet one. */
function Action({ children, onClick, disabled, kind = "solid", style }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; kind?: "solid" | "quiet"; style?: CSSProperties;
}) {
  const feel = useButtonFeel();
  const solid = kind === "solid";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      {...feel.handlers}
      style={chamferBox(8, {
        width: "100%", padding: "13px 0",
        background: disabled ? "#333344" : solid ? COMMUNITY : "#1a1a3a",
        color: disabled ? "#666677" : solid ? "#04142a" : "#aaaabb",
        border: "none", cursor: disabled ? "default" : "pointer",
        fontFamily: PIX, fontSize: 9, letterSpacing: 1,
        ...(disabled ? null : feelStyle(feel)),
        ...style,
      })}
    >
      {children}
    </button>
  );
}

function Empty({ line }: { line: string }) {
  return (
    <div style={chamferBox(8, {
      background: "#12122a",
      border: "1px solid rgba(255,255,255,0.04)",
      padding: 14,
      textAlign: "center",
      fontSize: 8,
      color: "#8a8aa7",
    })}>
      {line}
    </div>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────

export default function DonationPanel({ onClose }: { onClose: () => void }) {
  const [screen, setScreen] = useState<Screen>("home");
  // Where "GOT IT" and the title row's About button come back to.
  const [cameFrom, setCameFrom] = useState<Exclude<Screen, "about">>("home");

  const about = useCallback((from: Exclude<Screen, "about">) => { setCameFrom(from); setScreen("about"); }, []);

  // Giving happens on the panel's own screen rather than in Jupiter Cat's send
  // window. The two look alike and do the same thing to a wallet, but a
  // donation screen has to say what it is, cannot let the address be edited,
  // and must not offer the practice-SOL default that would send a donation
  // nowhere. See DonateScreen.
  if (screen === "about") return <AboutScreen onBack={() => setScreen(cameFrom)} onClose={onClose} />;
  if (screen === "amount") return <DonateScreen onBack={() => setScreen("home")} onAbout={() => about("amount")} onClose={onClose} />;
  return <HomeScreen onDonate={() => setScreen("amount")} onAbout={() => about("home")} onClose={onClose} />;
}

function HomeScreen({ onDonate, onAbout, onClose }: { onDonate: () => void; onAbout: () => void; onClose: () => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/donations?limit=10")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setBoard(d as Board); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ fontFamily: PIX }}>
      <PanelTitleBar
        title="DONATIONS"
        onClose={onClose}
        color={COMMUNITY}
        logo={<ProtocolLogo sheet="Donation Manager.png" />}
        extra={<AboutButton onClick={onAbout} />}
        style={{ marginBottom: 12 }}
      />

      <div style={{ fontSize: 15, color: LIME, lineHeight: 1.4 }}>Help build SolanaCity</div>
      <div style={{ fontSize: 8, color: "#e6e6f5", lineHeight: 1.7, marginTop: 6, marginBottom: 12 }}>
        Support the team behind the city.
      </div>

      <Action onClick={onDonate}>DONATE SOL</Action>
      {/* The point of the whole panel, kept right under the button that starts it. */}
      <div style={{ fontSize: 8, color: "#8a8aa7", textAlign: "center", lineHeight: 1.7, margin: "10px 0 12px" }}>
        Voluntary support. No items or gameplay advantages.
      </div>

      <div style={{ height: 1, background: `${COMMUNITY}44`, marginBottom: 12 }} />

      {/* The board. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 8, color: COMMUNITY }}>TOP DONORS</span>
        {board && (
          <span style={{ fontSize: 8, color: "#8a8aa7", textAlign: "right" }}>
            {formatSol(board.totalLamports)} SOL - {board.donorCount} {board.donorCount === 1 ? "donor" : "donors"}
          </span>
        )}
      </div>

      {failed ? (
        <Empty line="The board is not answering right now." />
      ) : !board ? (
        <Empty line="Reading the chain..." />
      ) : board.rows.length === 0 ? (
        <Empty line="No donations yet. Be the first." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {board.rows.map((row, i) => (
            <div
              key={row.wallet}
              style={chamferBox(6, {
                display: "flex", alignItems: "center", gap: 10,
                background: i === 0 ? "rgba(255,215,0,0.07)" : "#12122a",
                border: `1px solid ${i === 0 ? `${WARN}77` : "rgba(255,255,255,0.05)"}`,
                padding: "8px 10px",
              })}
            >
              <span style={{ fontSize: 8, color: i === 0 ? WARN : "#8a8aa7", width: 16, flexShrink: 0 }}>
                {i + 1}
              </span>
              <span style={{
                fontSize: 8, color: "#f0f0fa", flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {row.name ?? shortWallet(row.wallet)}
              </span>
              <span style={{ fontSize: 8, color: i === 0 ? WARN : COMMUNITY, flexShrink: 0 }}>
                {formatSol(row.lamports)} SOL
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 8, color: "#8a8aa7", marginTop: 8, textAlign: "center", lineHeight: 1.6 }}>
        Mainnet SOL donations appear here.
        {board?.stale ? " These numbers are a few minutes old." : ""}
      </div>
    </div>
  );
}

function AboutScreen({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const cards: Array<{ icon: string[]; title: string; text: string }> = [
    { icon: ICON_TEAM, title: "Supports the team", text: "Donations support the team building SolanaCity." },
    { icon: ICON_BAN, title: "Not a purchase", text: "No items, outfits or gameplay advantages." },
    { icon: ICON_COINS, title: "Mainnet SOL", text: "Real SOL leaves your wallet when you approve." },
    { icon: ICON_CHART, title: "Donor board", text: "Mainnet SOL donations are counted on the board." },
  ];
  return (
    <div style={{ fontFamily: PIX }}>
      <PanelTitleBar
        title="ABOUT DONATIONS"
        onClose={onClose}
        color={COMMUNITY}
        logo={<ProtocolLogo sheet="Donation Manager.png" />}
        style={{ marginBottom: 12 }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginBottom: 14 }}>
        {cards.map((c) => (
          <div
            key={c.title}
            style={chamferBox(8, {
              display: "flex", gap: 10, alignItems: "flex-start",
              background: "#12122a",
              border: "1px solid rgba(255,255,255,0.07)",
              padding: 12,
            })}
          >
            <PixelIcon cells={c.icon} size={30} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9, color: LIME, marginBottom: 7, lineHeight: 1.5 }}>{c.title}</div>
              <div style={{ fontSize: 8, color: "#d0d0e4", lineHeight: 1.7 }}>{c.text}</div>
            </div>
          </div>
        ))}
      </div>
      <Action onClick={onBack}>GOT IT</Action>
    </div>
  );
}

/**
 * The amounts the panel offers, in SOL.
 *
 * Presets rather than an empty box: the box starts at nothing, and "how much
 * is normal here" is a question nobody wants to answer in front of a wallet
 * prompt. Six choices fit two rows and cover a tip through a real donation,
 * with the custom box for anyone who already knows what they want to give.
 */
const PRESETS = ["0.01", "0.05", "0.1", "0.5", "1"] as const;

/** Mainnet SOL. Practice devnet SOL would reach nobody, so it is not offered. */
const SOL = getSendToken("sol");

/**
 * Giving, on its own screen.
 *
 * Deliberately not Jupiter Cat's send window with the address filled in. That
 * window is a general tool: it picks its own token, lets the address be typed
 * over, and opens on practice money. A donation screen can do none of those
 * things, so this one fixes the recipient, fixes the token to real SOL, and
 * leads with what the money is for. The transfer underneath is the same one
 * the send window builds.
 */
function DonateScreen({ onBack, onAbout, onClose }: { onBack: () => void; onAbout: () => void; onClose: () => void }) {
  const { connected, publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [choice, setChoice] = useState<string>("0.05");
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [result, setResult] = useState<{ signature?: string; error?: string } | null>(null);
  const { copied, copy } = useCopyWallet();

  const isCustom = choice === "custom";
  const amount = isCustom ? typed : choice;

  const send = useCallback(async () => {
    if (!publicKey || !amount || !SOL) return;
    const { buildSendTransfer, normalizeAmount, sendAndConfirmTransfer, awaitTransfer } =
      await import("@/game/solana/sendTokens");
    const { PublicKey } = await import("@solana/web3.js");

    const clean = normalizeAmount(amount);
    if (clean === null || parseFloat(clean) <= 0) {
      setResult({ error: "That is not an amount." });
      setStatus("error");
      return;
    }

    setStatus("sending");
    const logEntry = transactionLog.record({
      kind: "transfer",
      layer: "base",
      label: `Donate ${clean} SOL to the team`,
      status: "pending",
    });
    try {
      const { tx, connection: conn, lastValidBlockHeight } = await buildSendTransfer({
        token: SOL,
        devnetConnection: connection,
        from: publicKey,
        to: new PublicKey(DONATION_WALLET),
        amount: clean,
      });
      // Sign here and send over the token's own cluster, for the reason the
      // send window gives: a wallet's own sign-and-send broadcasts on whatever
      // network the wallet is set to, and this one has to be mainnet.
      // Signed here and broadcast by us, which is also what lets the send be
      // repeated until it lands. The wallet's own sign-and-send gives back a
      // signature and no way to push it again.
      let sig: string;
      if (signTransaction) {
        sig = await sendAndConfirmTransfer({
          connection: conn,
          signed: await signTransaction(tx),
          lastValidBlockHeight,
        });
      } else {
        sig = await sendTransaction(tx, conn);
        await awaitTransfer(conn, sig, lastValidBlockHeight);
      }
      setResult({ signature: sig });
      setStatus("done");
      transactionLog.markConfirmed(logEntry.id, sig);
      // No recordTransfer and no game:transfer here, both of which hand out
      // score. A donation that pays score is an advantage bought with money.
      // The board is the thank you and it is the whole of it.
    } catch (err) {
      const why = err instanceof Error ? err.message : "The donation did not go through.";
      setResult({ error: why });
      setStatus("error");
      transactionLog.markFailed(logEntry.id, why);
    }
  }, [publicKey, amount, connection, signTransaction, sendTransaction]);

  if (status === "done" && result?.signature) {
    return (
      <div style={{ fontFamily: PIX }}>
        <PanelTitleBar
          title="DONATION COMPLETE"
          onClose={onClose}
          color={COMMUNITY}
          logo={<ProtocolLogo sheet="Donation Manager.png" />}
          style={{ marginBottom: 10 }}
        />
        <div style={{ textAlign: "center", padding: "14px 0 6px" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <PixelIcon cells={ICON_CHECK} size={56} />
          </div>
          <div style={{ fontSize: 22, color: LIME, marginTop: 14 }}>Thank you!</div>
          <div style={{ fontSize: 10, color: "#fff", marginTop: 14 }}>{amount} SOL donated</div>
          <div style={{ fontSize: 8, color: "#d0d0e4", marginTop: 10, lineHeight: 1.7 }}>
            You helped support the SolanaCity team.
          </div>
          <a
            href={explorerUrl(result.signature, "mainnet")}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-block", marginTop: 14, fontSize: 9, color: COMMUNITY, textDecoration: "underline" }}
          >
            View transaction &#8599;
          </a>
        </div>
        <Action onClick={onBack} style={{ marginTop: 14 }}>BACK TO DONATIONS</Action>
      </div>
    );
  }

  const label = !connected ? "CONNECT WALLET FIRST"
    : status === "sending" ? "SENDING..."
    : status === "error" ? "TRY AGAIN"
    : `DONATE ${amount || "0"} SOL`;

  return (
    <div style={{ fontFamily: PIX }}>
      <PanelTitleBar
        title="DONATE SOL"
        onClose={onClose}
        color={COMMUNITY}
        logo={<ProtocolLogo sheet="Donation Manager.png" />}
        extra={(
          <>
            {/* A status, not a control: a lit square and the word, no frame, as the
                DEVNET mark on the login screen. */}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: WARN, fontSize: 8, letterSpacing: 1, whiteSpace: "nowrap" }}>
              <span aria-hidden style={{ width: 7, height: 7, background: WARN, boxShadow: "0 0 6px rgba(255,215,0,0.7)" }} />
              MAINNET
            </span>
            <AboutButton onClick={onAbout} short />
          </>
        )}
        style={{ marginBottom: 12 }}
      />

      {/* How much. */}
      <div style={{ fontSize: 9, color: "#fff", marginBottom: 8 }}>Choose an amount</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: isCustom ? 8 : 12 }}>
        {PRESETS.map((value) => (
          <Preset
            key={value}
            label={`${value} SOL`}
            active={choice === value}
            onClick={() => { setChoice(value); setStatus("idle"); setResult(null); }}
          />
        ))}
        <Preset
          label="CUSTOM"
          active={isCustom}
          onClick={() => { setChoice("custom"); setStatus("idle"); setResult(null); }}
        />
      </div>
      {isCustom && (
        <input
          type="text"
          inputMode="decimal"
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setStatus("idle"); setResult(null); }}
          placeholder="0.25"
          autoFocus
          style={{
            width: "100%", background: "transparent", color: "#fff", marginBottom: 12,
            border: "none", borderBottom: `1px solid ${COMMUNITY}77`, outline: "none",
            fontSize: 15, fontFamily: "monospace", fontWeight: "bold", padding: "4px 0",
          }}
        />
      )}

      {/* Where it goes. Text and not a field: this address is the point of the
          screen, and nothing good comes of letting it be typed over. */}
      <div style={chamferBox(8, {
        background: "#12122a",
        border: "1px solid rgba(255,255,255,0.07)",
        padding: "10px 12px",
        marginBottom: 12,
        fontSize: 9,
        lineHeight: 2,
      })}>
        <div style={{ display: "flex", gap: 14 }}>
          <span style={{ color: "#8a8aa7", width: 52, flexShrink: 0 }}>To:</span>
          <span style={{ color: "#f0f0fa" }}>SolanaCity team</span>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ color: "#8a8aa7", width: 52, flexShrink: 0 }}>Wallet:</span>
          <button
            onClick={copy}
            title="Copy the address"
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: 0, background: "none", border: "none",
              cursor: "pointer", color: "#f0f0fa", fontFamily: PIX, fontSize: 8,
            }}
          >
            {copied ? "COPIED" : SHORT_WALLET}
            <PixelIcon cells={ICON_COPY} size={13} color="#b6b6cc" />
          </button>
        </div>
      </div>

      <div style={{ fontSize: 8, color: WARN, textAlign: "center", lineHeight: 1.7 }}>
        Mainnet transaction - real SOL leaves your wallet.
      </div>
      <div style={{ fontSize: 8, color: "#b6b6cc", textAlign: "center", lineHeight: 1.7, marginBottom: 12 }}>
        Donation only. No items or gameplay advantages.
      </div>

      {/* wordBreak, because an RPC error carries an 88-character signature
          with no spaces in it and the window grew a scroll bar sideways. */}
      {status === "error" && result?.error && (
        <div style={{
          fontSize: 8, color: "#ff4444", textAlign: "center", marginBottom: 10,
          lineHeight: 1.6, wordBreak: "break-word", overflowWrap: "anywhere",
        }}>
          {result.error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Action kind="quiet" onClick={onBack} style={{ width: "auto", padding: "13px 18px" }}>BACK</Action>
        <Action
          onClick={send}
          disabled={!connected || status === "sending" || !amount}
          style={{ flex: 1, width: "auto" }}
        >
          {label}
        </Action>
      </div>
    </div>
  );
}

/** One amount button. Its own component so each can hold its own feel state. */
function Preset({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick}
      {...feel.handlers}
      style={chamferBox(6, {
        padding: "13px 0",
        background: active ? COMMUNITY : "#1a1a3a",
        color: active ? "#04142a" : "#c8c8de",
        border: "none",
        cursor: active ? "default" : "pointer",
        fontFamily: PIX,
        fontSize: 8,
        ...(active ? null : feelStyle(feel)),
      })}
    >
      {label}
    </button>
  );
}
