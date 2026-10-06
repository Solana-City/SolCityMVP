"use client";

/**
 * The ORE claim office (work in progress).
 *
 * ORE runs a 25 square board on Solana mainnet. Each round lasts about a
 * minute: miners put lamports on squares, the round closes, and the board pays
 * out ORE and SOL. This panel reads that board live and shows where the player
 * stands in it.
 *
 * Deploying is not wired yet, which the panel says plainly rather than offering
 * a button that does nothing. The money here is real mainnet SOL, so nothing
 * ships until it has been tested on a device with a minimum amount.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  SQUARE_COUNT,
  currentSlot,
  fetchBoard,
  fetchMiner,
  formatOre,
  roundProgress,
  slotsToSeconds,
  type OreBoard,
  type OreMiner,
} from "@/game/solana/ore";
import { PanelTitleBar } from "@/ui/PixelIcons";
import { CATEGORY_META } from "@/game/minimap/categories";

const ACCENT = CATEGORY_META.defi.color;
const DIM = "#6b7280";

const LAMPORTS = 1_000_000_000;

export default function OreMinePanel({ onClose }: { onClose: () => void }) {
  const { publicKey } = useWallet();
  const [board, setBoard] = useState<OreBoard | null>(null);
  const [miner, setMiner] = useState<OreMiner | null>(null);
  const [slot, setSlot] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [b, s] = await Promise.all([fetchBoard(), currentSlot()]);
    setBoard(b);
    setSlot(s);
    if (publicKey) setMiner(await fetchMiner(publicKey));
    setLoading(false);
  }, [publicKey]);

  useEffect(() => {
    void refresh();
    // Rounds last about a minute, so this is slow enough to be polite to the
    // public RPC and quick enough that the timer never looks frozen.
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const progress = board ? roundProgress(board, slot) : 0;
  const slotsLeft = board ? Math.max(0, Number(board.endSlot) - slot) : 0;
  const mine = miner?.deployed ?? [];
  const deployedHere = mine.reduce((a, b) => a + Number(b), 0) / LAMPORTS;

  return (
    <div style={{ fontFamily: '"Press Start 2P", monospace', color: "#e6e6f0" }}>
      <PanelTitleBar title="ORE CLAIM OFFICE" color={ACCENT} onClose={onClose} />

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <Notice />

        {loading && <div style={{ fontSize: 9, color: DIM }}>Reading the board...</div>}

        {!loading && !board && (
          <div style={{ fontSize: 9, color: DIM }}>
            The board is not answering right now. Try again in a moment.
          </div>
        )}

        {board && (
          <>
            <Row label="ROUND" value={`#${board.roundId.toString()}`} />
            <div>
              <Row
                label="TIME LEFT"
                value={slotsLeft > 0 ? `${slotsToSeconds(slotsLeft)}s` : "closing"}
              />
              <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, marginTop: 6 }}>
                <div
                  style={{
                    width: `${Math.round(progress * 100)}%`,
                    height: "100%",
                    background: ACCENT,
                    borderRadius: 3,
                    transition: "width 1s linear",
                  }}
                />
              </div>
            </div>
            <Row
              label="ORE COST"
              value={`${(Number(board.productionCostEma) / LAMPORTS).toFixed(3)} SOL`}
            />

            <Grid mine={mine} />

            {publicKey ? (
              <>
                <Row label="YOUR SQUARES" value={`${mine.filter((v) => v > BigInt(0)).length} of ${SQUARE_COUNT}`} />
                <Row label="DEPLOYED" value={`${deployedHere.toFixed(4)} SOL`} />
                <Row label="CLAIMABLE ORE" value={miner ? formatOre(miner.rewardsOre) : "0.0000"} />
                <Row
                  label="CLAIMABLE SOL"
                  value={miner ? (Number(miner.rewardsSol) / LAMPORTS).toFixed(4) : "0.0000"}
                />
              </>
            ) : (
              <div style={{ fontSize: 9, color: DIM }}>Connect a wallet to see your claims.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Says what is not finished, instead of a button that does nothing. */
function Notice() {
  return (
    <div
      style={{
        border: `1px solid ${ACCENT}55`,
        background: "rgba(20,241,149,0.06)",
        padding: 10,
        fontSize: 9,
        lineHeight: 1.7,
      }}
    >
      <div style={{ color: ACCENT, marginBottom: 6 }}>WORK IN PROGRESS</div>
      You can watch the board here. Staking a claim is not open yet.
      <div style={{ color: "#ffd166", marginTop: 8 }}>
        ORE runs on Solana mainnet. Real SOL, not the city&apos;s test money.
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 8, color: DIM }}>{label}</span>
      <span style={{ fontSize: 10 }}>{value}</span>
    </div>
  );
}

/** The 25 squares, with the player's own marked. */
function Grid({ mine }: { mine: bigint[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
      {Array.from({ length: SQUARE_COUNT }, (_, i) => {
        const taken = (mine[i] ?? BigInt(0)) > BigInt(0);
        return (
          <div
            key={i}
            style={{
              aspectRatio: "1",
              border: `1px solid ${taken ? ACCENT : "rgba(255,255,255,0.12)"}`,
              background: taken ? `${ACCENT}33` : "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 7,
              color: taken ? ACCENT : "rgba(255,255,255,0.25)",
            }}
          >
            {i + 1}
          </div>
        );
      })}
    </div>
  );
}
