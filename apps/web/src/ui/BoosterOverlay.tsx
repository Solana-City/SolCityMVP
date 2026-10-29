"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { CATEGORY_LABELS } from "@/game/config/paperDoll";
import {
  PACKS, RARITY_COLOR, RARITY_LABEL, RARITY_ORDER, rarityTheme, CURRENT_SEASON,
  rollPack, type PackDef, type PackDrop,
} from "@/game/config/packs";
import { unlockItem } from "@/game/config/wardrobeUnlocks";
import {
  settleMints, readMintConfig,
  type MintConfigAccount, type SignedMints,
} from "@/game/solana/mint";
import {
  buySealedPacks, heldSealedPacks, openSealedPack,
} from "@/game/solana/sealedPacks";
/** Mirrors MAX_BUNDLE_ITEMS: what one draw may resolve. */
const MAX_BUNDLE_ITEMS = 50;
import { progressionBus } from "@/game/progression/progressionBus";
import { ChromaPreview } from "@/ui/WardrobePanel";
import { chamferBox } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";
import { useButtonFeel, feelStyle, type ButtonFeel } from "@/ui/useButtonFeel";
import { useEscape } from "@/ui/useEscape";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BOOSTER_ONCHAIN } from "@/game/solana/program";
import { itemAtGlobalIndex } from "@/game/config/catalogIndex";
import { rarityOf } from "@/game/config/packs";
import { getVariant } from "@/game/config/paperDoll";
import {
  baseConnection, readPackConfig, currencyBalance, buyPack, packUnavailableReason,
  type PackConfigAccount,
  syncOwnedToWardrobe, awaitDraw, ownedIndices,
} from "@/game/solana/packs";

/**
 * Outfit packs — PREVIEW. Three packs, each with its own odds per rarity,
 * drawing from the season the city is in.
 *
 * Two draws live here, and which one runs is BOOSTER_ONCHAIN.
 *
 * OFF: client-side `Math.random`, granted into localStorage, free. The
 * preview, and still what a guest or a wallet with no currency sees.
 *
 * ON: the real thing. `open_booster` charges the pack's price in the config's
 * currency, requests randomness from MagicBlock VRF, and an oracle callback
 * grants the items into the wallet's UnlockState seconds later. Paying and
 * being granted are two different transactions, which is why the reveal
 * WATCHES the account rather than reading a result: there is nothing to read
 * when the payment confirms.
 *
 * Pack art is an animated strip (see the internal art-requests list). Until a
 * pack's sheet is drawn, its card falls back to the wardrobe icon rather than
 * an empty box.
 */
export default function BoosterOverlay({
  wallet, onClose,
}: {
  wallet: string | null;
  onClose: () => void;
}) {
  const [pack, setPack] = useState<PackDef | null>(null);
  const [phase, setPhase] = useState<"choose" | "opening" | "revealed">("choose");
  const [drops, setDrops] = useState<PackDrop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<PackConfigAccount | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  // One signing call for everything here. A purchase and the mint that
  // follows it are approved together or the flow is broken.
  const { signAllTransactions } = useWallet();
  /**
   * How many packs this purchase buys, resolved as ONE draw.
   *
   * One payment, one randomness request, one reveal. The ceiling is the
   * program's: a wallet can hold one draw in flight, and the callback has to
   * roll the whole bundle in a single transaction that is not allowed to
   * fail. So fifty items, which is ten five-item packs.
   */
  const [count, setCount] = useState(1);
  /**
   * Skip the per-item animation and show the whole haul at once.
   *
   * Remembered, because somebody opening ten packs has already decided how
   * they feel about the animation and should not have to say so again.
   */
  const [skipReveal, setSkipReveal] = useState(() => {
    try { return localStorage.getItem("solcity:skip-reveal") === "1"; } catch { return false; }
  });
  const [minting, setMinting] = useState(false);
  const [mintConfig, setMintConfig] = useState<MintConfigAccount | null>(null);
  const [sealed, setSealed] = useState<{ assetId: PublicKey; packId: number; nonce: number }[]>([]);
  const [sealing, setSealing] = useState<number | null>(null);
  const [mintNote, setMintNote] = useState<string | null>(null);

  const setSkip = useCallback((on: boolean) => {
    setSkipReveal(on);
    try { localStorage.setItem("solcity:skip-reveal", on ? "1" : "0"); } catch { /* fine */ }
  }, []);

  /** The most packs of this kind that still fit one draw. */
  const maxCount = useMemo(
    () => (pack ? Math.max(1, Math.floor(MAX_BUNDLE_ITEMS / Math.max(1, pack.size))) : 1),
    [pack],
  );

  // What the city actually sells, read once when the overlay opens. Only when
  // the paid draw is on: the preview has no prices to be wrong about.
  useEffect(() => {
    if (!BOOSTER_ONCHAIN || !wallet) return;
    let cancelled = false;
    void (async () => {
      try {
        const conn = baseConnection();
        const cfg = await readPackConfig(conn);
        if (cancelled) return;
        setConfig(cfg);
        if (cfg) setBalance(await currencyBalance(conn, new PublicKey(wallet), cfg.currencyMint));
      } catch { /* the preview prices stay on screen */ }
    })();
    return () => { cancelled = true; };
  }, [wallet]);

  /**
   * What this wallet already holds sealed.
   *
   * Asked of the indexer, because a sealed pack is an ordinary asset that may
   * have arrived from anywhere: bought here, bought on a marketplace, or
   * given. Nothing in our own accounts knows about it.
   */
  const refreshSealed = useCallback(async (cfg: MintConfigAccount | null) => {
    if (!wallet || !cfg) { setSealed([]); return; }
    try {
      setSealed(await heldSealedPacks(baseConnection(), new PublicKey(wallet), cfg));
    } catch {
      // An unreachable indexer hides the sealed list rather than claiming the
      // player has none.
    }
  }, [wallet]);

  useEffect(() => {
    if (!BOOSTER_ONCHAIN || !wallet) return;
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await readMintConfig(baseConnection());
        if (cancelled) return;
        setMintConfig(cfg);
        await refreshSealed(cfg);
      } catch { /* the sealed row simply does not appear */ }
    })();
    return () => { cancelled = true; };
  }, [wallet, refreshSealed]);

  /**
   * Turns a resolved draw into a reveal, and mints it.
   *
   * Shared by the two ways a pack is spent, because from here they are the
   * same thing: a list of indices that have to become wearable. Opening a
   * sealed pack and buying one to open now differ only in what preceded the
   * oracle's answer.
   */
  const revealAndMint = useCallback(async (
    granted: number[],
    conn: ReturnType<typeof baseConnection>,
    me: PublicKey,
    /** Signed at the till, so sending them asks nobody anything. */
    presigned: SignedMints | null,
    /** Everything those transactions owe: this draw plus any leftovers. */
    owed: number[],
  ) => {
      if (!wallet) return;
      // Before anything is shown as wearable. The chain is what authorises a
      // pack item now, so the reveal would otherwise offer hats the wardrobe
      // still refuses to put on.
      await syncOwnedToWardrobe(conn, me);

      const rolled: PackDrop[] = [];
      for (const index of granted) {
        const entry = itemAtGlobalIndex(index);
        if (!entry) continue;
        const variant = getVariant(entry.category, entry.variant.id);
        if (!variant) continue;
        rolled.push({
          category: entry.category,
          id: variant.id,
          name: variant.name,
          file: variant.file,
          rarity: rarityOf(entry.category, variant.id),
          owned: false,
        });
        unlockItem(wallet, entry.category, variant.id, variant.name, true);
      }
      if (rolled.length > 0) {
        progressionBus.emit({
          type: "outfit-unlocked",
          outfitId: "booster",
          outfitName: `${rolled.length} new item${rolled.length === 1 ? "" : "s"} from a pack`,
        });
      }
      setDrops(rolled);
      setPhase("revealed");

      // MINTING IS NOT A SECOND DECISION, and by here it is not a second
      // APPROVAL either: these transactions were signed in the same breath as
      // the payment. Sending them is all that is left, and it happens behind
      // the reveal the player is already watching.
      if (owed.length > 0) {
        setMinting(true);
        try {
          const { failed } = await settleMints({
            conn,
            wallet: me,
            presigned,
            expected: owed,
            // Only reached when the pre-signed route is gone: minting not set
            // up, or a draw slower than a blockhash lives. It asks, which is
            // the thing all of this exists to avoid.
            signAllTransactions,
          });
          // Anything that did not land stays in UnlockState, so the
          // wardrobe's own mint button finishes it. Said plainly rather than
          // hidden, because until it lands the item cannot be worn.
          if (failed.length > 0) {
            setMintNote(
              `${failed.length} still to mint. Finish from the wardrobe whenever you like.`,
            );
          }
        } catch (err) {
          setMintNote((err as Error).message?.split("\n")[0] ?? "The mint did not go through.");
        } finally {
          setMinting(false);
        }
      }
  }, [wallet, signAllTransactions]);

  /** Buys `count` of this pack sealed, in one approval. */
  const seal = useCallback(async (chosen: PackDef) => {
    if (!wallet || !signAllTransactions || !config || !mintConfig) return;
    const onChain = config.packs.find((p) => p.id === chosen.onChainId);
    if (!onChain) { setError("This pack is not on sale yet."); return; }
    const why = packUnavailableReason(onChain, config);
    if (why) { setError(why); return; }

    setSealing(chosen.onChainId);
    setError(null);
    try {
      await buySealedPacks({
        wallet: new PublicKey(wallet), pack: onChain, config, mintConfig,
        count, signAllTransactions,
      });
      // The indexer needs a moment to see a brand new leaf, so the list is
      // re-read rather than guessed at.
      setTimeout(() => void refreshSealed(mintConfig), 2500);
    } catch (err) {
      setError((err as Error).message?.split("\n")[0] ?? "The purchase failed.");
    } finally {
      setSealing(null);
    }
  }, [wallet, signAllTransactions, config, mintConfig, count, refreshSealed]);

  /** Burns one sealed pack and waits for its reveal. */
  const openSealed = useCallback(async (entry: { assetId: PublicKey; packId: number; nonce: number }) => {
    if (!wallet || !signAllTransactions || !config || !mintConfig) return;
    const onChain = config.packs.find((p) => p.id === entry.packId);
    if (!onChain) { setError("That pack is not one this city knows."); return; }
    const card = PACKS.find((p) => p.onChainId === entry.packId) ?? PACKS[0];

    setPack(card);
    setPhase("opening");
    setError(null);
    try {
      const { presignedMints, leftover } = await openSealedPack({
        wallet: new PublicKey(wallet), assetId: entry.assetId, nonce: entry.nonce,
        pack: onChain, mintConfig, signAllTransactions,
      });
      // From here it is the same reveal a bought-and-opened pack gets: the
      // draw lands in UnlockState when the oracle answers.
      // The same wait a bought-and-opened pack gets, then the same reveal
      // and the same mint, because from the oracle's side nothing differs.
      const conn = baseConnection();
      const me = new PublicKey(wallet);
      const before = new Set(await ownedIndices(conn, me));
      const { granted, timedOut } = await awaitDraw(conn, me, before);
      if (timedOut) {
        setError("Opened, but the draw has not landed yet. It will appear in your wardrobe.");
        setPhase("choose");
        return;
      }
      const owed = [...leftover, ...granted.filter((i) => !leftover.includes(i))]
        .sort((a, b) => a - b);
      await revealAndMint(granted, conn, me, presignedMints, owed);
      void refreshSealed(mintConfig);
    } catch (err) {
      setError((err as Error).message?.split("\n")[0] ?? "That pack would not open.");
      setPhase("choose");
    }
  }, [wallet, signAllTransactions, config, mintConfig, refreshSealed, revealAndMint]);
  const laterFeel = useButtonFeel();
  const anotherFeel = useButtonFeel();
  const doneFeel = useButtonFeel();

  const open = useCallback((chosen: PackDef) => {
    if (!wallet) return;
    setPack(chosen);
    setPhase("opening");
    setError(null);
    if (BOOSTER_ONCHAIN && config && signAllTransactions) {
      void openOnChain(chosen);
      return;
    }
    const rolled = rollPack(wallet, chosen);
    // Brief suspense, then reveal + grant. Suspense is the thing the skip
    // toggle removes, so there is nothing to wait through when it is on.
    setTimeout(() => {
      let newCount = 0;
      for (const d of rolled) {
        if (unlockItem(wallet, d.category, d.id, d.name, true)) newCount++;
      }
      // One summary event → single toast + wardrobe re-render (the grants ran
      // silent so they don't spam a toast each).
      if (newCount > 0) {
        progressionBus.emit({
          type: "outfit-unlocked",
          outfitId: "booster",
          outfitName: `${newCount} new item${newCount === 1 ? "" : "s"} from a pack`,
        });
      }
      setDrops(rolled);
      setPhase("revealed");
    }, skipReveal ? 0 : 650);
  }, [wallet]);

  /**
   * The paid draw.
   *
   * The granted items come back as CATALOG indices, because that is what the
   * program stores: the chain has no idea what a "Crown" is. They are turned
   * back into wardrobe items here, and anything this build does not recognise
   * is dropped rather than guessed at - an index from a newer catalog is a
   * real possibility and showing the wrong hat is worse than showing one
   * fewer.
   *
   * The local unlock still happens, so the wardrobe reads the same whether the
   * draw was paid or previewed. It is a mirror of the chain now, not the
   * record.
   */
  const openOnChain = useCallback(async (chosen: PackDef) => {
    if (!wallet || !signAllTransactions || !config) return;
    const onChain = config.packs.find((p) => p.id === chosen.onChainId);
    if (!onChain) { setError("This pack is not on sale yet."); setPhase("choose"); return; }
    const why = packUnavailableReason(onChain, config);
    if (why) { setError(why); setPhase("choose"); return; }

    try {
      const conn = baseConnection();
      const result = await buyPack({
        conn, wallet: new PublicKey(wallet), signAllTransactions, pack: onChain, config,
        count,
      });
      if (result.timedOut) {
        setError("Paid, but the draw has not landed yet. It will appear in your wardrobe.");
        setPhase("choose");
        return;
      }
      await revealAndMint(
        result.granted, conn, new PublicKey(wallet), result.presignedMints, result.owed,
      );
    } catch (err) {
      // The wallet's own message is the useful one: "insufficient funds",
      // "User rejected the request".
      setError((err as Error).message?.split("\n")[0] ?? "The purchase failed.");
      setPhase("choose");
    }
  }, [wallet, signAllTransactions, config, count, revealAndMint]);


  const backToPacks = () => { setPhase("choose"); setDrops([]); setPack(null); setError(null); };
  // Not mid-opening, same as the backdrop: the pack is already being granted.
  useEscape(phase === "opening" ? null : onClose);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(2,3,10,0.82)", backdropFilter: "blur(6px)",
        fontFamily: '"Press Start 2P", monospace',
        padding: 12, overflowY: "auto",
      }}
      onClick={e => { if (e.target === e.currentTarget && phase !== "opening") onClose(); }}
    >
      <style>{`
        @keyframes booster-shake { 0%,100%{transform:translateX(0) rotate(0)} 25%{transform:translateX(-4px) rotate(-3deg)} 75%{transform:translateX(4px) rotate(3deg)} }
        @keyframes booster-glow  { 0%,100%{filter:drop-shadow(0 0 12px rgba(183,233,40,0.5))} 50%{filter:drop-shadow(0 0 22px rgba(183,233,40,0.9))} }
        @keyframes booster-pop   { 0%{transform:scale(0.5) translateY(10px);opacity:0} 60%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
        @keyframes pack-roll     { from { background-position: 0 0 } to { background-position: var(--roll) 0 } }
        /* A phone held sideways (the Seeker is about 915x412): the three tall
           cards plus the header did not fit and the window was cut off. Each
           card lies down instead (art left, details right) and the paddings
           shrink, which takes the chooser from ~470px to ~270px tall. */
        @media (pointer: coarse) and (max-height: 520px) {
          .booster-panel { padding: 10px 14px 8px !important; }
          .booster-sub   { margin-bottom: 8px !important; }
          .booster-grid  { gap: 8px !important; margin-bottom: 8px !important; }
          .pack-card     { flex-direction: row !important; padding: 10px !important; gap: 10px !important; }
          .pack-card > div:first-child { flex-shrink: 0; }
          .pack-info     { gap: 5px !important; }
          .pack-blurb    { display: none !important; }
        }
      `}</style>

      <div className="booster-panel" style={{
        width: phase === "choose" ? "min(720px, 96vw)" : "min(560px, 94vw)",
        background: "#0b0e1c",
        borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
        borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
        imageRendering: "pixelated",
        padding: "22px 22px 18px",
        color: "#d0d0f0",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 10, color: "#B7E928", letterSpacing: 2, marginBottom: 4 }}>
          {phase === "choose" ? "OUTFIT PACKS" : pack?.name}
        </div>
        <div className="booster-sub" style={{ fontSize: 6, color: "#FFD700", opacity: 0.7, letterSpacing: 1, marginBottom: 18 }}>
          SEASON {CURRENT_SEASON} · PREVIEW · RANDOMNESS → MAGICBLOCK VRF
        </div>

        {!wallet ? (
          <div style={{ fontSize: 8, color: "#aaaacc", lineHeight: 1.8, padding: "20px 0" }}>
            Connect a wallet to open packs.
          </div>
        ) : phase === "choose" ? (
          <>
            {/* The paid draw's two reasons a pack cannot be opened: something
                went wrong, or there is no money. Both say so before the player
                clicks, because a wallet popup that fails reads as the game
                being broken. */}
            {error && (
              <div style={{
                fontSize: 8, color: "#ff9aa6", lineHeight: 1.8,
                padding: "8px 10px", marginBottom: 12,
                border: "1px solid #ff9aa6",
                background: "rgba(255,154,166,0.08)",
              }}>{error}</div>
            )}
            {BOOSTER_ONCHAIN && balance !== null && balance === BigInt(0) && (
              <div style={{ fontSize: 8, color: "#aaaacc", lineHeight: 1.8, marginBottom: 12 }}>
                This wallet has no balance in the currency packs are priced in.
              </div>
            )}
            {/* HOW MANY, and whether to watch them open.
                One payment, one draw, one reveal however many are bought:
                the quantity is part of the purchase, not a button pressed
                again and again. The ceiling comes from the program. */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              fontSize: 8, color: "#aaaacc", marginBottom: 12, flexWrap: "wrap",
            }}>
              <span>HOW MANY</span>
              {[1, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  style={{
                    fontFamily: "inherit", fontSize: 8, padding: "4px 10px",
                    cursor: "pointer", background: "transparent",
                    border: `1px solid ${count === n ? "#14F195" : "#3a3a55"}`,
                    color: count === n ? "#14F195" : "#aaaacc",
                  }}
                >{n}</button>
              ))}
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={skipReveal}
                  onChange={(e) => setSkip(e.target.checked)}
                />
                Skip the reveal and show everything at once
              </label>
            </div>

            <div className="booster-grid" style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 12, marginBottom: 16,
            }}>
              {PACKS.map((p) => (
                <PackCard
                  key={p.id}
                  pack={p}
                  onOpen={() => open(p)}
                  onSeal={() => void seal(p)}
                  sealing={sealing === p.onChainId}
                />
              ))}
            </div>
            {/* WHAT YOU ALREADY HOLD SEALED.
                Below the shop rather than beside it, because these are not
                for sale: they are already yours, and the only question left
                is when to open them. Absent entirely when there are none,
                since an empty shelf is worse than no shelf. */}
            {sealed.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 8, color: "#aaaacc", letterSpacing: 1, marginBottom: 8 }}>
                  YOUR SEALED PACKS
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {sealed.map((entry) => {
                    const card = PACKS.find((c) => c.onChainId === entry.packId);
                    return (
                      <button
                        key={entry.assetId.toBase58()}
                        onClick={() => void openSealed(entry)}
                        style={chamferBox(8, {
                          fontFamily: '"Press Start 2P", monospace', fontSize: 7,
                          padding: "10px 12px", cursor: "pointer",
                          background: "rgba(255,255,255,0.03)",
                          color: card?.accent ?? "#aaaacc",
                          border: `1px solid ${(card?.accent ?? "#3a3a55")}66`,
                        })}
                      >
                        OPEN {card?.name ?? `PACK ${entry.packId}`}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 6, color: "#7a7aa0", marginTop: 8, lineHeight: 1.5 }}>
                  Opening burns the pack. What is inside is drawn at that moment, not before.
                </div>
              </div>
            )}

            <button onClick={onClose} {...laterFeel.handlers} style={btn("ghost", laterFeel)}>LATER</button>
          </>
        ) : phase === "revealed" ? (
          <>
            {minting && (
              <div style={{ fontSize: 8, color: "#14F195", marginBottom: 10 }}>
                MINTING…
              </div>
            )}
            {mintNote && (
              <div style={{ fontSize: 8, color: "#ffa726", lineHeight: 1.8, marginBottom: 10 }}>
                {mintNote}
              </div>
            )}
            {/* One column per item stops being a layout at ten and is a
                hairline at fifty, so the grid wraps once a bundle is more
                than a single pack. */}
            <div style={{
              display: "grid",
              gridTemplateColumns: drops.length > 5
                ? "repeat(auto-fit, minmax(72px, 1fr))"
                : `repeat(${Math.max(1, drops.length)}, 1fr)`,
              gap: 8, marginBottom: 18,
            }}>
              {drops.map((d, i) => (
                <div
                  key={`${d.category}:${d.id}`}
                  style={chamferBox(10, {
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                    padding: "10px 4px",
                    background: d.owned ? "rgba(255,255,255,0.02)" : rarityTheme(d.rarity).fill,
                    border: `2px solid ${d.owned ? "rgba(255,255,255,0.08)" : rarityTheme(d.rarity).color}`,
                    // The STAGGER is the reveal: each card popping in turn.
                    // Skipping drops the delay rather than the animation, so
                    // the haul still arrives rather than appearing to have
                    // always been there. At fifty items the stagger alone
                    // would run four and a half seconds.
                    animation: skipReveal
                      ? "booster-pop 0.25s ease-out both"
                      : `booster-pop 0.4s ${i * 0.09}s ease-out both`,
                  })}
                >
                  {/* Cropped, same as the wardrobe grid: the reveal is about
                      the item, not the character it sits on. */}
                  <ChromaPreview file={d.file} size={60} facingUp={d.category === "back"} crop />
                  <span style={{ fontSize: 8, color: "#e0d0ff", lineHeight: 1.3, textAlign: "center" }}>{d.name}</span>
                  <span style={{ fontSize: 8, color: "#7a7aa0", letterSpacing: 0.5 }}>
                    {CATEGORY_LABELS[d.category]}
                  </span>
                  <span style={{ fontSize: 8, letterSpacing: 0.5, color: RARITY_COLOR[d.rarity] }}>
                    {RARITY_LABEL[d.rarity]}
                  </span>
                  <span style={{
                    fontSize: 8, letterSpacing: 0.5,
                    color: d.owned ? "#888" : "#B7E928",
                  }}>{d.owned ? "OWNED" : "NEW"}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={backToPacks} {...anotherFeel.handlers} style={btn("ghost", anotherFeel)}>OPEN ANOTHER</button>
              <ChamferGlow glow={BTN_GLOW}><button onClick={onClose} {...doneFeel.handlers} style={btn("primary", doneFeel)}>DONE</button></ChamferGlow>
            </div>
          </>
        ) : (
          <div style={{
            display: "inline-block", margin: "6px auto 24px",
            animation: "booster-shake 0.16s linear infinite, booster-glow 0.5s ease-in-out infinite",
          }}>
            {pack && <PackArt pack={pack} scale={3} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** One pack on the chooser: its art, what it costs, and what it rolls. */
/**
 * One pack, with the TWO things that can be done with it.
 *
 * Opening now and keeping it sealed are different products, not a setting:
 * one ends in cosmetics, the other in a tradeable asset somebody might
 * never open. So they are two buttons of equal standing rather than a
 * primary action with a modifier hidden beside it.
 */
function PackCard({ pack, onOpen, onSeal, sealing }: {
  pack: PackDef;
  onOpen: () => void;
  onSeal: () => void;
  sealing: boolean;
}) {
  const openFeel = useButtonFeel();
  const sealFeel = useButtonFeel();
  return (
    <div className="pack-card" style={chamferBox(12, {
      padding: "14px 12px 12px",
      background: "rgba(255,255,255,0.02)",
      border: `2px solid ${pack.accent}55`,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
    })}>
      <PackArt pack={pack} scale={2} />
      <div className="pack-info" style={{ flex: 1, minWidth: 0, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 8, color: pack.accent, letterSpacing: 1 }}>{pack.name}</div>
      <div className="pack-blurb" style={{ fontSize: 6, color: "#8a8aa7", lineHeight: 1.6, minHeight: 20 }}>{pack.blurb}</div>

      {/* The odds, as a bar per rarity: a table of four percentages is four
          numbers nobody reads, where the bar says "this one is better" at a
          glance and still carries the number for whoever wants it. */}
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 3 }}>
        {RARITY_ORDER.map((r) => (
          <div key={r} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, flexShrink: 0, background: RARITY_COLOR[r] }} />
            <span style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)" }}>
              <span style={{
                display: "block", height: "100%",
                width: `${pack.odds[r]}%`, background: RARITY_COLOR[r],
              }} />
            </span>
            <span style={{ fontSize: 8, color: "#7a7aa0", width: 32, textAlign: "right" }}>
              {pack.odds[r]}%
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 6, color: "#7a7aa0", letterSpacing: 0.5 }}>
        {pack.size} PIECES · {pack.priceSol} SOL
      </div>
      <ChamferGlow glow={`drop-shadow(0 0 10px ${pack.accent}55)`} style={{ display: "block", width: "100%" }}>
        <button
          onClick={onOpen}
          {...openFeel.handlers}
          style={chamferBox(8, {
            width: "100%", fontFamily: '"Press Start 2P", monospace',
            fontSize: 7, letterSpacing: 1, padding: "10px 8px", cursor: "pointer",
            background: pack.accent, color: "#04140c", border: "none",
            ...feelStyle(openFeel),
          })}
        >
          OPEN
        </button>
      </ChamferGlow>
      <button
        onClick={onSeal}
        disabled={sealing}
        {...sealFeel.handlers}
        style={chamferBox(8, {
          width: "100%", fontFamily: '"Press Start 2P", monospace',
          fontSize: 7, letterSpacing: 1, padding: "9px 8px",
          cursor: sealing ? "default" : "pointer",
          background: "transparent", color: pack.accent,
          border: `1px solid ${pack.accent}77`,
          ...feelStyle(sealFeel),
        })}
      >
        {sealing ? "BUYING…" : "KEEP SEALED"}
      </button>
      {/* Said once, on the card, because "sealed" is the whole product and a
          player meeting it for the first time has no reason to guess. */}
      <div style={{ fontSize: 6, color: "#7a7aa0", lineHeight: 1.5, textAlign: "center" }}>
        Sealed packs can be traded or gifted, and opened whenever you like.
      </div>
      </div>
    </div>
  );
}

/**
 * A pack's animated sheet, played on a CSS step animation so it costs no
 * JavaScript per frame.
 *
 * Drawn at a WHOLE multiple of the frame, never at a target size: a 51px tall
 * bag stretched to fit an 84px box lands its pixels on fractions of a screen
 * pixel, and pixel art resampled at a fraction is the tearing the interface
 * was fixed for (see ui/crispPixels.ts). So the caller asks for 2x or 3x and
 * the box takes the size that follows.
 *
 * A missing file falls back to the wardrobe icon in the pack's own colour,
 * which is what the chooser showed before the art arrived.
 */
function PackArt({ pack, scale }: { pack: PackDef; scale: number }) {
  const width = pack.art.frameWidth * scale;
  const height = pack.art.frameHeight * scale;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setReady(true); };
    img.onerror = () => { if (alive) setReady(false); };
    img.src = pack.art.file;
    return () => { alive = false; };
  }, [pack.art.file]);

  if (!ready) {
    return (
      <div style={chamferBox(14, {
        width, height,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `linear-gradient(135deg, ${pack.accent}33, rgba(183,233,40,0.12))`,
        border: `2px solid ${pack.accent}77`,
      })}>
        <img
          src="/assets/ui/ico_wardrop.png" alt="" draggable={false}
          style={{ width: width * 0.6, height: width * 0.6, imageRendering: "pixelated" }}
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden
      style={{
        width, height,
        backgroundImage: `url("${pack.art.file}")`,
        backgroundSize: `${width * pack.art.frames}px ${height}px`,
        backgroundRepeat: "no-repeat",
        imageRendering: "pixelated",
        // The strip is walked one frame at a time and wraps at its full width.
        ["--roll" as string]: `-${width * pack.art.frames}px`,
        animation: `pack-roll ${(pack.art.frames / 8).toFixed(2)}s steps(${pack.art.frames}) infinite`,
      }}
    />
  );
}

const BTN_GLOW = "drop-shadow(0 0 10px rgba(183,233,40,0.45))";

function btn(kind: "primary" | "ghost", feel?: Pick<ButtonFeel, "hover" | "pressed">): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 9, letterSpacing: 1, padding: "12px 24px",
    cursor: "pointer",
  };
  return chamferBox(8, kind === "primary"
    ? { ...base, background: "#B7E928", color: "#0a0a14",
        border: "none", ...(feel ? feelStyle(feel) : null) }
    : { ...base, background: "transparent", color: "#8a8aa7", border: "1px solid rgba(183,233,40,0.3)", ...(feel ? feelStyle(feel) : null) });
}
