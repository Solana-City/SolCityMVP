"use client";

/**
 * The ORE claim office.
 *
 * ORE runs a 25 square board on Solana mainnet. A round lasts about a minute:
 * miners put SOL on squares, the round closes, and the board pays out ORE and
 * SOL. Here a player watches that board, stakes a claim on it, settles a
 * finished round and takes what it paid.
 *
 * Two things this screen never lets the player forget. The money is real
 * mainnet SOL, not the city's test money, which is said in the panel and again
 * on the button. And a claim is only staked into a round that is already
 * running: between rounds the program wants entropy accounts there is no
 * reliable way to pick, so the office waits instead of guessing.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  SQUARE_COUNT,
  currentSlot,
  fetchBoard,
  fetchMiner,
  formatOre,
  lastOreError,
  needsCheckpoint,
  roundProgress,
  slotsToSeconds,
  type OreBoard,
  type OreMiner,
} from "@/game/solana/ore";
import {
  claimOre,
  claimSol,
  roundIsOpen,
  settleRound,
  stakeClaim,
  type ActionResult,
} from "@/game/solana/oreActions";
import { squaresToMask } from "@/game/solana/oreInstructions";
import { PanelTitleBar } from "@/ui/PixelIcons";
import {
  cityClaims,
  getShareClaims,
  pruneClaims,
  setShareClaims,
  type CitySquare,
} from "@/game/chat/claimBroadcast";
import { onOreStaked, onOreWon } from "@/game/progression/outfitRewards";
import { CATEGORY_META } from "@/game/minimap/categories";

const ACCENT = CATEGORY_META.defi.color;
const DIM = "#6b7280";
const WARN = "#ffd166";
const BAD = "#ff6b6b";

const LAMPORTS = 1_000_000_000;

/** Per square. Small on purpose: the first thing a player does is a test. */
const AMOUNTS = [0.002, 0.005, 0.01, 0.05];

function emitGameEvent(event: string, payload?: unknown): void {
  ((globalThis as unknown as { __solCityGameEvents?: { emit: (e: string, p?: unknown) => void } })
    .__solCityGameEvents)?.emit(event, payload);
}

export default function OreMinePanel({ onClose }: { onClose: () => void }) {
  const { publicKey, signTransaction } = useWallet();
  const [board, setBoard] = useState<OreBoard | null>(null);
  const [miner, setMiner] = useState<OreMiner | null>(null);
  const [slot, setSlot] = useState(0);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState<{ squares: CitySquare[]; citizens: number } | null>(null);

  const [picked, setPicked] = useState<number[]>([]);
  const [perSquare, setPerSquare] = useState(AMOUNTS[0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);

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
  const open = board ? roundIsOpen(board, slot) : false;
  const owesCheckpoint = board ? needsCheckpoint(miner, board) : false;
  const total = picked.length * perSquare;
  const canSign = Boolean(publicKey && signTransaction);

  const toggle = (square: number) =>
    setPicked((p) => (p.includes(square) ? p.filter((s) => s !== square) : [...p, square]));

  /** Runs one action, keeping the panel honest about what happened. */
  const run = async (label: string, action: () => Promise<ActionResult>, onDone?: () => void) => {
    setBusy(label);
    setNotice(null);
    const result = await action();
    setBusy(null);
    if (result.error) {
      setNotice({ text: result.error, bad: true });
      return;
    }
    onDone?.();
    await refresh();
  };

  const onStake = () =>
    run(
      "staking",
      () =>
        stakeClaim({
          authority: publicKey!,
          signTransaction: signTransaction!,
          lamportsPerSquare: BigInt(Math.round(perSquare * LAMPORTS)),
          squaresMask: squaresToMask(picked),
          board: board!,
          miner,
        }),
      () => {
        // Moves the achievement track. The helmet is not earned here: a stake
        // is a bet, and the trophy waits until ORE is actually struck.
        onOreStaked();
        // The city's claim map, unless this player opted out.
        if (getShareClaims()) {
          emitGameEvent("game:ore-claim", {
            roundId: Number(board!.roundId),
            squares: squaresToMask(picked),
            sol: total,
          });
        }
        setNotice({ text: `Staked ${total.toFixed(4)} SOL on ${picked.length}.` });
        setPicked([]);
      },
    );

  return (
    <div style={{ fontFamily: '"Press Start 2P", monospace', color: "#e6e6f0" }}>
      <PanelTitleBar title="ORE CLAIM OFFICE" color={ACCENT} onClose={onClose} />

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 8, color: WARN, lineHeight: 1.7 }}>
          ORE runs on Solana mainnet. Real SOL, not the city&apos;s test money.
        </div>

        {loading && <div style={{ fontSize: 9, color: DIM }}>Reading the board...</div>}

        {!loading && !board && (
          <div style={{ fontSize: 9, color: DIM, lineHeight: 1.7 }}>
            The board is not answering right now. Try again in a moment.
            {lastOreError() && (
              <div style={{ fontSize: 7, color: BAD, marginTop: 6 }}>{lastOreError()}</div>
            )}
          </div>
        )}

        {board && (
          <>
            <Row label="ROUND" value={`#${board.roundId.toString()}`} />
            <div>
              <Row
                label="TIME LEFT"
                value={open ? `${slotsToSeconds(slotsLeft)}s` : "between rounds"}
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

            <Grid mine={mine} city={city?.squares} picked={picked} onPick={toggle} />
            <CityLine citizens={city?.citizens ?? 0} />

            {!canSign ? (
              <div style={{ fontSize: 9, color: DIM }}>Connect a wallet to stake a claim.</div>
            ) : (
              <>
                <Amounts value={perSquare} onPick={setPerSquare} />

                <div style={{ fontSize: 8, color: DIM, lineHeight: 1.7 }}>
                  {picked.length === 0
                    ? "Tap squares above to pick them."
                    : `${picked.length} ${picked.length === 1 ? "square" : "squares"} at ${perSquare} SOL each.`}
                </div>

                {owesCheckpoint && (
                  <div style={{ fontSize: 8, color: WARN, lineHeight: 1.7 }}>
                    You left round #{miner?.roundId.toString()} unsettled. It is settled in the
                    same signature.
                  </div>
                )}

                <Button
                  label={
                    busy === "staking"
                      ? "SIGNING..."
                      : open
                        ? `STAKE ${total.toFixed(4)} SOL`
                        : "WAITING FOR THE NEXT ROUND"
                  }
                  disabled={!open || picked.length === 0 || busy !== null}
                  onClick={onStake}
                />

                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    small
                    label={busy === "ore" ? "..." : `CLAIM ${miner ? formatOre(miner.rewardsOre, 3) : "0"} ORE`}
                    disabled={!miner || miner.rewardsOre <= BigInt(0) || busy !== null}
                    onClick={() => {
                      // Read before the claim: afterwards the account says zero,
                      // so this is the only moment that knows ORE was really won.
                      const won = miner?.rewardsOre ?? BigInt(0);
                      void run(
                        "ore",
                        () => claimOre(publicKey!, signTransaction!),
                        () => {
                          if (won > BigInt(0)) {
                            onOreWon();
                            setNotice({ text: `You struck ${formatOre(won, 4)} ORE.` });
                          }
                        },
                      );
                    }}
                  />
                  <Button
                    small
                    label={
                      busy === "sol"
                        ? "..."
                        : `CLAIM ${miner ? (Number(miner.rewardsSol) / LAMPORTS).toFixed(3) : "0"} SOL`
                    }
                    disabled={!miner || miner.rewardsSol <= BigInt(0) || busy !== null}
                    onClick={() => run("sol", () => claimSol(publicKey!, signTransaction!))}
                  />
                </div>

                {owesCheckpoint && (
                  <Button
                    small
                    label={busy === "settle" ? "..." : "SETTLE LAST ROUND"
                    }
                    disabled={busy !== null}
                    onClick={() =>
                      run("settle", () => settleRound(publicKey!, signTransaction!, miner!.roundId))
                    }
                  />
                )}

                <Row label="DEPLOYED THIS ROUND" value={`${deployedHere.toFixed(4)} SOL`} />
                <Row
                  label="LIFETIME"
                  value={miner ? `${(Number(miner.lifetimeDeployed) / LAMPORTS).toFixed(3)} SOL` : "0"}
                />
              </>
            )}

            {notice && (
              <div style={{ fontSize: 8, color: notice.bad ? BAD : ACCENT, lineHeight: 1.7 }}>
                {notice.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Button({
  label, onClick, disabled, small,
}: { label: string; onClick: () => void; disabled?: boolean; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: small ? 1 : undefined,
        width: small ? undefined : "100%",
        padding: small ? "8px 6px" : "12px 10px",
        fontFamily: '"Press Start 2P", monospace',
        fontSize: small ? 7 : 9,
        color: disabled ? DIM : "#06111a",
        background: disabled ? "rgba(255,255,255,0.06)" : ACCENT,
        border: "none",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

/** How much goes on each square. */
function Amounts({ value, onPick }: { value: number; onPick: (v: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {AMOUNTS.map((a) => (
        <button
          key={a}
          onClick={() => onPick(a)}
          style={{
            flex: 1,
            padding: "8px 2px",
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 7,
            color: a === value ? "#06111a" : "#c9cde0",
            background: a === value ? ACCENT : "rgba(255,255,255,0.05)",
            border: `1px solid ${a === value ? ACCENT : "rgba(255,255,255,0.12)"}`,
            cursor: "pointer",
          }}
        >
          {a}
        </button>
      ))}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 8, color: DIM }}>{label}</span>
      <span style={{ fontSize: 10 }}>{value}</span>
    </div>
  );
}

/** The 25 squares: the player's own, the city's crowd, and the current pick. */
function Grid({
  mine, city, picked, onPick,
}: {
  mine: bigint[];
  city?: CitySquare[];
  picked: number[];
  onPick: (square: number) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
      {Array.from({ length: SQUARE_COUNT }, (_, i) => {
        const taken = (mine[i] ?? BigInt(0)) > BigInt(0);
        const crowd = city?.[i]?.citizens ?? 0;
        const isPicked = picked.includes(i + 1);
        return (
          <button
            key={i}
            onClick={() => onPick(i + 1)}
            style={{
              position: "relative",
              aspectRatio: "1",
              padding: 0,
              cursor: "pointer",
              border: `1px solid ${isPicked ? "#fff" : taken ? ACCENT : crowd > 0 ? `${ACCENT}66` : "rgba(255,255,255,0.12)"}`,
              borderStyle: !taken && !isPicked && crowd > 0 ? "dashed" : "solid",
              // The more citizens on a square, the warmer it reads.
              background: isPicked
                ? `${ACCENT}99`
                : taken
                  ? `${ACCENT}33`
                  : crowd > 0
                    ? `rgba(20,241,149,${Math.min(0.28, 0.07 * crowd)})`
                    : "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 7,
              color: isPicked ? "#06111a" : taken ? ACCENT : crowd > 0 ? "#c9cde0" : "rgba(255,255,255,0.25)",
            }}
          >
            {i + 1}
            {crowd > 0 && (
              <span style={{ position: "absolute", bottom: 1, right: 2, fontSize: 6, color: ACCENT }}>
                {crowd}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
