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
import {
  cityClaims,
  getShareClaims,
  pruneClaims,
  setShareClaims,
  type CitySquare,
} from "@/game/chat/claimBroadcast";
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
  const [city, setCity] = useState<{ squares: CitySquare[]; citizens: number } | null>(null);

  const refresh = useCallback(async () => {
    const [b, s] = await Promise.all([fetchBoard(), currentSlot()]);
    setBoard(b);
    setSlot(s);
    if (publicKey) setMiner(await fetchMiner(publicKey));
    if (b) {
      const round = Number(b.roundId);
      pruneClaims(round);
      setCity(cityClaims(round));
    }
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

            <Grid mine={mine} city={city?.squares} />
            <CityLine citizens={city?.citizens ?? 0} />

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

/** One line about the crowd, plus the control over being part of it. */
function CityLine({ citizens }: { citizens: number }) {
  const [share, setShare] = useState(true);
  useEffect(() => { setShare(getShareClaims()); }, []);
  const toggle = () => { const v = !share; setShare(v); setShareClaims(v); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 8, color: DIM, lineHeight: 1.6 }}>
        {citizens > 0
          ? `${citizens} ${citizens === 1 ? "citizen is" : "citizens are"} on the board this round. Their squares are the dotted ones.`
          : "No citizen has staked a claim this round yet."}
      </div>
      <button
        onClick={toggle}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "4px 0",
          background: "none", border: "none", cursor: "pointer",
          fontFamily: '"Press Start 2P", monospace', fontSize: 7,
          color: share ? "#c9cde0" : DIM, textAlign: "left",
        }}
      >
        <span style={{
          width: 10, height: 10, flexShrink: 0,
          border: `1px solid ${share ? ACCENT : DIM}`,
          background: share ? ACCENT : "transparent",
        }} />
        Show my claim on the city map
      </button>
    </div>
  );
}

/** The 25 squares: the player's own marked, the city's crowd dotted. */
function Grid({ mine, city }: { mine: bigint[]; city?: CitySquare[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
      {Array.from({ length: SQUARE_COUNT }, (_, i) => {
        const taken = (mine[i] ?? BigInt(0)) > BigInt(0);
        const crowd = city?.[i]?.citizens ?? 0;
        return (
          <div
            key={i}
            style={{
              position: "relative",
              aspectRatio: "1",
              border: `1px solid ${taken ? ACCENT : crowd > 0 ? `${ACCENT}66` : "rgba(255,255,255,0.12)"}`,
              borderStyle: !taken && crowd > 0 ? "dashed" : "solid",
              // The more citizens on a square, the warmer it reads.
              background: taken
                ? `${ACCENT}33`
                : crowd > 0
                  ? `rgba(20,241,149,${Math.min(0.28, 0.07 * crowd)})`
                  : "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 7,
              color: taken ? ACCENT : crowd > 0 ? "#c9cde0" : "rgba(255,255,255,0.25)",
            }}
          >
            {i + 1}
            {crowd > 0 && (
              <span style={{ position: "absolute", bottom: 1, right: 2, fontSize: 6, color: ACCENT }}>
                {crowd}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
