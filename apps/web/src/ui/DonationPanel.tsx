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

import { PanelTitleBar, ProtocolLogo } from "@/ui/PixelIcons";
import { CATEGORY_META } from "@/game/minimap/categories";
import { chamferBox } from "@/ui/chamfer";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";
import { SEND_TOKENS_EVENT } from "@/game/chat/dmEvents";
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

  // Hands the address to the send panel already filled in, on real mainnet
  // SOL: a donation paid in practice devnet SOL would reach nobody.
  const donate = useCallback(() => {
    window.dispatchEvent(new CustomEvent(SEND_TOKENS_EVENT, {
      detail: { wallet: DONATION_WALLET, name: "Project team", token: "sol" },
    }));
    onClose();
  }, [onClose]);

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
