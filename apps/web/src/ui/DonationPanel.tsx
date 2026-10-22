"use client";

/**
 * The Donation Manager's panel.
 *
 * Two things only: how to give, and who has. The one point it will not let a
 * player miss is that this is a donation to the team and not a purchase, so
 * that sentence is the first block on the panel rather than small print at the
 * bottom, and the confirm button says "donate" rather than "buy".
 *
 * Nothing here grants anything. No item, no outfit, no advantage, no place in
 * any queue. The board is a thank you, and it is the whole reward.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";

import { PanelTitleBar, ProtocolLogo, ExternalLinkIcon } from "@/ui/PixelIcons";
import { CATEGORY_META } from "@/game/minimap/categories";
import { chamferBox } from "@/ui/chamfer";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";
import { transactionLog } from "@/game/telemetry/transactionLog";
import { getSendToken, explorerUrl } from "@/game/solana/sendTokens";
import { DONATION_WALLET, formatSol, shortWallet } from "@/lib/donationWallet";

const COMMUNITY = CATEGORY_META.community.color;
const WARN = "#FFD700";


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

export default function DonationPanel({ onClose }: { onClose: () => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [giving, setGiving] = useState(false);
  const copyFeel = useButtonFeel();
  const donateFeel = useButtonFeel();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/donations?limit=10")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setBoard(d as Board); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(DONATION_WALLET)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
      .catch(() => {});
  }, []);

  // Giving happens on this panel's own second screen rather than in Jupiter
  // Cat's send window. The two look alike and do the same thing to a wallet,
  // but a donation screen has to say what it is, cannot let the address be
  // edited, and must not offer the practice-SOL default that would send a
  // donation nowhere. See DonateScreen.
  const donate = useCallback(() => setGiving(true), []);

  if (giving) return <DonateScreen onBack={() => setGiving(false)} onClose={onClose} />;

  return (
    <div style={{ fontFamily: '"Press Start 2P", monospace' }}>
      <PanelTitleBar
        title="DONATIONS"
        onClose={onClose}
        color={COMMUNITY}
        logo={<ProtocolLogo sheet="Donation Manager.png" />}
        style={{ marginBottom: 10 }}
      />

      {/* The point of the whole panel, so it goes first and not in small print. */}
      <div style={chamferBox(8, {
        background: "rgba(255,215,0,0.08)",
        border: `1px solid ${WARN}55`,
        padding: 12,
        marginBottom: 10,
      })}>
        <div style={{ fontSize: 8, color: WARN, marginBottom: 6 }}>THIS IS A DONATION</div>
        <div style={{ fontSize: 8, color: "#ccccdd", lineHeight: 1.7 }}>
          Money sent here supports the team building this city.
        </div>
        <div style={{ fontSize: 8, color: "#ccccdd", lineHeight: 1.7, marginTop: 5 }}>
          It is not a purchase. It buys no items, no outfits and no advantages.
        </div>
      </div>

      {/* How to give: the address, copyable, and a shortcut into the send panel. */}
      <div style={chamferBox(8, {
        background: "#12122a",
        border: "1px solid rgba(255,255,255,0.04)",
        padding: 12,
        marginBottom: 8,
      })}>
        <div style={{ fontSize: 8, color: "#555566", marginBottom: 6 }}>Donation wallet</div>
        <div style={{ fontSize: 9, fontFamily: "monospace", color: "#fff", wordBreak: "break-all", lineHeight: 1.5 }}>
          {DONATION_WALLET}
        </div>
        <button
          onClick={copy}
          {...copyFeel.handlers}
          style={chamferBox(6, {
            marginTop: 10, width: "100%", padding: "8px 0",
            background: copied ? COMMUNITY : "#1a1a3a",
            color: copied ? "#000" : "#aaaabb",
            border: "none", cursor: "pointer",
            fontFamily: '"Press Start 2P", monospace', fontSize: 7,
            ...feelStyle(copyFeel),
          })}
        >
          {copied ? "COPIED" : "COPY ADDRESS"}
        </button>
      </div>

      <button
        onClick={donate}
        {...donateFeel.handlers}
        style={chamferBox(8, {
          width: "100%", padding: "11px 0", marginBottom: 12,
          background: COMMUNITY, color: "#000", border: "none", cursor: "pointer",
          fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 1,
          ...feelStyle(donateFeel),
        })}
      >
        DONATE SOL
      </button>

      {/* The board. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 8, color: COMMUNITY }}>TOP DONORS</span>
        {board && (
          <span style={{ fontSize: 7, color: "#777788" }}>
            {formatSol(board.totalLamports)} SOL from {board.donorCount}
          </span>
        )}
      </div>

      {failed ? (
        <Empty line="The board is not answering right now." />
      ) : !board ? (
        <Empty line="Reading the chain…" />
      ) : board.rows.length === 0 ? (
        <Empty line="No donations yet. Be the first." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {board.rows.map((row, i) => (
            <div
              key={row.wallet}
              style={chamferBox(6, {
                display: "flex", alignItems: "center", gap: 8,
                background: i === 0 ? "rgba(255,215,0,0.07)" : "#12122a",
                border: `1px solid ${i === 0 ? `${WARN}44` : "rgba(255,255,255,0.04)"}`,
                padding: "8px 10px",
              })}
            >
              <span style={{ fontSize: 8, color: i === 0 ? WARN : "#555566", width: 16, flexShrink: 0 }}>
                {i + 1}
              </span>
              <span style={{
                fontSize: 8, color: "#ccccdd", flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {row.name ?? shortWallet(row.wallet)}
              </span>
              <span style={{ fontSize: 8, color: i === 0 ? WARN : COMMUNITY, flexShrink: 0 }}>
                {formatSol(row.lamports)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 7, color: "#555566", marginTop: 10, textAlign: "center", lineHeight: 1.6 }}>
        SOL donations on mainnet are counted on the board.
        {board?.stale ? " These numbers are a few minutes old." : ""}
      </div>
    </div>
  );
}

function Empty({ line }: { line: string }) {
  return (
    <div style={chamferBox(8, {
      background: "#12122a",
      border: "1px solid rgba(255,255,255,0.04)",
      padding: 16,
      textAlign: "center",
      fontSize: 8,
      color: "#777788",
    })}>
      {line}
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
const PRESETS = ["0.01", "0.05", "0.1", "0.5", "1.0"] as const;

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
function DonateScreen({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const { connected, publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [choice, setChoice] = useState<string>("0.05");
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [result, setResult] = useState<{ signature?: string; error?: string } | null>(null);
  const backFeel = useButtonFeel();
  const sendFeel = useButtonFeel();
  const doneFeel = useButtonFeel();

  const isCustom = choice === "custom";
  const amount = isCustom ? typed : choice;

  const send = useCallback(async () => {
    if (!publicKey || !amount || !SOL) return;
    const { buildSendTransfer, normalizeAmount } = await import("@/game/solana/sendTokens");
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
      const { tx, connection: conn } = await buildSendTransfer({
        token: SOL,
        devnetConnection: connection,
        from: publicKey,
        to: new PublicKey(DONATION_WALLET),
        amount: clean,
      });
      // Sign here and send over the token's own cluster, for the reason the
      // send window gives: a wallet's own sign-and-send broadcasts on whatever
      // network the wallet is set to, and this one has to be mainnet.
      const sig = signTransaction
        ? await conn.sendRawTransaction((await signTransaction(tx)).serialize())
        : await sendTransaction(tx, conn);
      await conn.confirmTransaction(sig, "confirmed");
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

  const title = (
    <PanelTitleBar
      title="DONATE SOL"
      onClose={onClose}
      color={COMMUNITY}
      logo={<ProtocolLogo sheet="Donation Manager.png" />}
      style={{ marginBottom: 10 }}
    />
  );

  if (status === "done" && result?.signature) {
    return (
      <div style={{ fontFamily: '"Press Start 2P", monospace' }}>
        {title}
        <div style={{ textAlign: "center", padding: "18px 0" }}>
          <div style={{ fontSize: 22, color: COMMUNITY }}>OK</div>
          <div style={{ fontSize: 8, color: COMMUNITY, marginTop: 10 }}>THANK YOU</div>
          <div style={{ fontSize: 9, color: "#888899", marginTop: 8 }}>{amount} SOL donated</div>
          <a
            href={explorerUrl(result.signature, "mainnet")}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 10, fontSize: 9, color: COMMUNITY }}
          >
            View on Explorer <ExternalLinkIcon size={9} color={COMMUNITY} />
          </a>
          <button
            onClick={onBack}
            {...doneFeel.handlers}
            style={chamferBox(8, {
              width: "100%", marginTop: 18, padding: "11px 0",
              background: COMMUNITY, color: "#000", border: "none", cursor: "pointer",
              fontFamily: '"Press Start 2P", monospace', fontSize: 7,
              ...feelStyle(doneFeel),
            })}
          >
            BACK TO THE BOARD
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: '"Press Start 2P", monospace' }}>
      {title}

      <div style={chamferBox(8, {
        background: "rgba(255,215,0,0.08)",
        border: `1px solid ${WARN}55`,
        padding: 10,
        marginBottom: 10,
      })}>
        <div style={{ fontSize: 8, color: "#ccccdd", lineHeight: 1.7 }}>
          A donation to the team. It buys no items and no advantages.
        </div>
      </div>

      {/* How much. */}
      <div style={chamferBox(8, {
        background: "#12122a",
        border: "1px solid rgba(255,255,255,0.04)",
        padding: 12,
        marginBottom: 8,
      })}>
        <div style={{ fontSize: 8, color: "#555566", marginBottom: 8 }}>Amount in SOL</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {PRESETS.map((value) => (
            <Preset
              key={value}
              label={value}
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
              marginTop: 10, width: "100%", background: "transparent", color: "#fff",
              border: "none", borderBottom: `1px solid ${COMMUNITY}55`, outline: "none",
              fontSize: 15, fontFamily: "monospace", fontWeight: "bold", padding: "4px 0",
            }}
          />
        )}
      </div>

      {/* Where it goes. Text and not a field: this address is the point of the
          screen, and nothing good comes of letting it be typed over. */}
      <div style={chamferBox(8, {
        background: "#0e0e22",
        border: "1px solid rgba(255,255,255,0.04)",
        padding: 12,
        marginBottom: 8,
      })}>
        <div style={{ fontSize: 8, color: "#555566", marginBottom: 6 }}>Goes to the project team</div>
        <div style={{ fontSize: 9, fontFamily: "monospace", color: "#8888a0", wordBreak: "break-all", lineHeight: 1.5 }}>
          {DONATION_WALLET}
        </div>
      </div>

      <div style={{ fontSize: 7, color: WARN, textAlign: "center", marginTop: 4, marginBottom: 12, lineHeight: 1.6 }}>
        SOL on mainnet. Real money leaves your wallet.
      </div>

      {status === "error" && result?.error && (
        <div style={{ fontSize: 8, color: "#ff4444", textAlign: "center", marginBottom: 10, lineHeight: 1.6 }}>
          {result.error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onBack}
          {...backFeel.handlers}
          style={chamferBox(8, {
            padding: "11px 14px", background: "#1a1a3a", color: "#aaaabb",
            border: "none", cursor: "pointer",
            fontFamily: '"Press Start 2P", monospace', fontSize: 7,
            ...feelStyle(backFeel),
          })}
        >
          BACK
        </button>
        <button
          onClick={send}
          disabled={!connected || status === "sending" || !amount}
          {...sendFeel.handlers}
          style={chamferBox(8, {
            flex: 1, padding: "11px 0",
            background: connected ? COMMUNITY : "#333344",
            color: connected ? "#000" : "#666677",
            border: "none", cursor: connected ? "pointer" : "default",
            fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 1,
            ...feelStyle(sendFeel),
          })}
        >
          {!connected ? "CONNECT WALLET FIRST"
            : status === "sending" ? "SENDING..."
            : status === "error" ? "TRY AGAIN"
            : `DONATE ${amount || "0"} SOL`}
        </button>
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
        padding: "9px 0",
        background: active ? COMMUNITY : "#1a1a3a",
        color: active ? "#000" : "#aaaabb",
        border: "none",
        cursor: active ? "default" : "pointer",
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 7,
        ...(active ? null : feelStyle(feel)),
      })}
    >
      {label}
    </button>
  );
}
