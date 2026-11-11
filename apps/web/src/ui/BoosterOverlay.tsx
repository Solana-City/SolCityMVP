"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { CATEGORY_LABELS } from "@/game/config/paperDoll";
import {
  PACKS, RARITY_COLOR, RARITY_LABEL, RARITY_ORDER, rarityTheme, CURRENT_SEASON,
  type PackDef, type PackDrop,
} from "@/game/config/packs";
import { unlockItem } from "@/game/config/wardrobeUnlocks";
import {
  settleMints, readMintConfig, requestSponsoredMint, pendingMintIndices,
  syncAfterMint, commonCopies, withoutCopies,
  type MintConfigAccount, type SignedMints,
} from "@/game/solana/mint";
import {
  buySealedPacks, heldSealedPacks, openSealedPack,
} from "@/game/solana/sealedPacks";
/** Mirrors MAX_BUNDLE_ITEMS: what one draw may resolve. */
const MAX_BUNDLE_ITEMS = 50;
import { progressionBus } from "@/game/progression/progressionBus";
import { ChromaPreview } from "@/ui/WardrobePanel";
import { RarityFrame, innerSize } from "@/ui/RarityFrame";
import { chamferBox } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";
import { useButtonFeel, feelStyle, type ButtonFeel } from "@/ui/useButtonFeel";
import { useEscape } from "@/ui/useEscape";
import { useWallet } from "@solana/wallet-adapter-react";
import { resilientSigner } from "@/game/solana/walletTx";
import { PublicKey } from "@solana/web3.js";
import { BOOSTER_ONCHAIN } from "@/game/solana/program";
import { getNetwork } from "@/game/multiplayer/OnChainMultiplayer";
import { itemAtGlobalIndex } from "@/game/config/catalogIndex";
import { rarityOf } from "@/game/config/packs";
import { getVariant, showsFromBehind } from "@/game/config/paperDoll";
import {
  baseConnection, readPackConfig, currencyBalance, buyPack, packUnavailableReason, buyerIsTreasury,
  fundsShortfall, txErrorText,
  type PackConfigAccount,
  syncOwnedToWardrobe, awaitDraw, hasPendingDraw, retryStuckDraw,
} from "@/game/solana/packs";

/**
 * Outfit packs — PREVIEW. Three packs, each with its own odds per rarity,
 * drawing from the season the city is in.
 *
 * One draw, on chain. The free client-side preview (`Math.random`, granted
 * into this browser only) was removed on 2026-11-10: it drew by rules the
 * real pack no longer has (no repeats, unowned first), and with the paid draw
 * switched off the shop now says packs are unavailable instead.
 *
 * `open_booster` charges the pack's price in the config's
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
/** The framed item in the reveal. Bigger than a wardrobe tile: the reveal is
 *  the one moment the player is looking AT the item rather than for it. */
const REVEAL_TILE = 72;

/** This wallet receives the shop's payments, and the program will not let it pay itself. */
const TREASURY_WALLET_MSG = "This wallet is the shop's treasury and can't buy from itself. Use another wallet.";
/** An address as people recognise it in a wallet: the first and last four. */
function shortKey(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
const NO_SIGNER_MSG = "Your wallet can't sign here. Reconnect it and try again.";
const LOADING_MSG = "The shop is still loading. Try again in a moment.";
/** No mint config on chain: a pack could be paid for and never become wearable. */
const MINT_NOT_READY_MSG = "Minting isn't set up on this network yet, so packs aren't on sale.";

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
  const { signAllTransactions: adapterSignAll, signTransaction: adapterSignOne, publicKey } = useWallet();
  // One transaction per approval, through signTransaction, and past a 4100
  // through Phantom's own provider (walletTx.ts, resilientSigner).
  const signAllTransactions = useMemo(
    () => resilientSigner({
      signAll: adapterSignAll, signOne: adapterSignOne, expected: publicKey?.toBase58() ?? null,
    }),
    [adapterSignAll, adapterSignOne, publicKey],
  );
  /**
   * The account the city plays as (`wallet`, from the profile) against the
   * one active in the wallet. Every transaction here is built for the first
   * and signed by the second, and when they differ Phantom refuses the batch
   * with 4100, "not authorized", which disconnecting and reconnecting does not
   * fix if it reconnects on the other account (devnet, 2026-11-05). So it is
   * checked before the wallet is asked, and named.
   */
  const active = publicKey?.toBase58() ?? null;
  const mismatch = wallet && active && active !== wallet
    ? `Your wallet is on ${shortKey(active)}, but you're in the city as ${shortKey(wallet)}. `
      + `Switch to ${shortKey(wallet)} in your wallet and try again.`
    : null;
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
  const [mintedAll, setMintedAll] = useState(false);
  const [mintConfig, setMintConfig] = useState<MintConfigAccount | null>(null);
  /**
   * Sealed packs this wallet holds, or null for "we could not find out".
   *
   * The distinction is the whole reliability of this screen. An empty list
   * and a dead indexer look identical if both are `[]`, and telling somebody
   * who owns a pack that they own nothing is the one answer this must never
   * give.
   */
  const [sealed, setSealed] =
    useState<{ assetId: PublicKey; packId: number; nonce: number }[] | null>(null);
  const [sealedBusy, setSealedBusy] = useState(false);
  /**
   * Which half of the shop is showing.
   *
   * A tab rather than a shelf below the grid, because of where a sealed pack
   * comes from: it may have been bought on a marketplace, or given, and in
   * neither case did this screen have anything to do with it. Somebody
   * arriving to look for it needs a place that is there BEFORE they own
   * anything, or there is no answer to "where is my pack".
   */
  const [tab, setTab] = useState<"buy" | "mine">("buy");
  const [sealing, setSealing] = useState<number | null>(null);
  const [mintNote, setMintNote] = useState<string | null>(null);
  /**
   * A pack this wallet paid for that the oracle has not answered.
   *
   * Checked when the overlay opens as well as after a timeout, because the
   * draw that got stuck may be from yesterday. While it is set the program
   * refuses every other pack for this wallet, so the overlay offers the one
   * thing that helps: asking the oracle again.
   */
  const [stuck, setStuck] = useState(false);
  const [retrying, setRetrying] = useState(false);

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
        if (!cancelled) setStuck(await hasPendingDraw(conn, new PublicKey(wallet)));
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
    // No MintConfig means no tree and no collection, so a sealed pack cannot
    // exist yet. That is knowledge, not a failure, and the empty list is
    // the honest answer.
    if (!wallet || !cfg) { setSealed([]); return; }
    setSealedBusy(true);
    try {
      setSealed(await heldSealedPacks(baseConnection(), new PublicKey(wallet), cfg));
    } catch {
      // Unknown, and SAID to be unknown. The packs are on chain either way;
      // what failed is our ability to look, and the tab says so rather than
      // showing an empty shelf to somebody holding three.
      setSealed(null);
    } finally {
      setSealedBusy(false);
    }
  }, [wallet]);

  useEffect(() => {
    // Off chain, or no wallet: a sealed pack cannot exist, and the tab says so
    // plainly instead of sitting in "we could not find out".
    if (!BOOSTER_ONCHAIN || !wallet) { setSealed([]); return; }
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
    /** Everything owed after the draw: any leftovers, then this draw. */
    owed: number[],
    /** What the wallet could already wear before this pack: a copy of one
     *  of these, or a second copy within the pack, is marked as a repeat. */
    ownedBefore: Set<number>,
  ) => {
      if (!wallet) return;
      // Before anything is shown as wearable. The chain is what authorises a
      // pack item now, so the reveal would otherwise offer hats the wardrobe
      // still refuses to put on.
      await syncOwnedToWardrobe(conn, me);
      // And into the snapshot the PROGRAM checks outfits against, which is a
      // different copy. Outfit writes fail closed now, so putting on a new
      // item before this lands would be refused. Not awaited: it is a session
      // transaction, and the reveal should not wait on it.
      void getNetwork()?.refreshUnlockSnapshot();

      // Every copy is shown, repeats included: every one of them becomes an
      // asset. A repeat is MARKED as one, never collapsed into "x2", which
      // would read as the same item counted twice in one pack (owner,
      // 2026-11-10).
      const rolled: PackDrop[] = [];
      const seen = new Set(ownedBefore);
      let fresh = 0;
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
          owned: seen.has(index),
        });
        if (!seen.has(index)) fresh++;
        seen.add(index);
        unlockItem(wallet, entry.category, variant.id, variant.name, true);
      }
      if (fresh > 0) {
        progressionBus.emit({
          type: "outfit-unlocked",
          outfitId: "booster",
          outfitName: `${fresh} new item${fresh === 1 ? "" : "s"} from a pack`,
        });
      }
      setDrops(rolled);
      setPhase("revealed");

      // MINTING IS NOT A SECOND DECISION, and with the sponsor it is not a
      // second approval either. The mint cannot ride in the purchase (the
      // program refuses it until the draw lands, and Phantom would not sign
      // that batch), so once the draw is in, the site's sponsor wallet sends
      // it (/api/mint): every owed item, this pack's and any older ones, with
      // nothing asked of the player. It runs behind the reveal they are
      // already watching.
      //
      // Only when the sponsor is not there (no key, no SOL, an old program)
      // or misses something does the wallet get asked: one transaction for
      // THIS pack's items, never a batch (devnet, 2026-11-05: a reveal of 3
      // asked to mint 16 in a batch that never landed). Older items it does
      // not cover stay for the wardrobe's mint button, and are named.
      setMintNote(null);
      setMintedAll(false);
      if (owed.length === 0) return;
      setMinting(true);
      try {
        const sponsored = await requestSponsoredMint(me, { conn });
        // Counted by COPY: a pack can owe the same item twice, and an item
        // minted before is no sign that this copy was.
        const stillThisPack = commonCopies(granted, await pendingMintIndices(conn, me));
        let failedThisPack: number[] = [];
        if (stillThisPack.length > 0) {
          ({ failed: failedThisPack } = await settleMints({
            conn,
            wallet: me,
            presigned,
            expected: stillThisPack,
            signAllTransactions,
          }));
        }
        // Whatever the sponsor delivered is held and wearable now, even before
        // the indexer lists it, and no tile still reads MINT NOW for it.
        await syncAfterMint(conn, me, sponsored.minted);
        const older = withoutCopies(await pendingMintIndices(conn, me), failedThisPack).length;
        // Anything that did not land stays in the MintQueue, so the wardrobe's
        // own mint button finishes it. Said plainly rather than hidden,
        // because until it lands the item cannot be worn.
        if (failedThisPack.length > 0 || older > 0) {
          const parts = [
            failedThisPack.length > 0 ? `${failedThisPack.length} from this pack still to mint.` : "",
            older > 0 ? `${older} older item${older === 1 ? " is" : "s are"} still to mint.` : "",
          ].filter(Boolean);
          setMintNote(`${parts.join(" ")} Finish from the wardrobe whenever you like.`);
        } else {
          // Said, not just hidden: the line used to vanish with nothing in
          // its place, which read as "it stopped" (devnet, 2026-11-11).
          setMintedAll(true);
        }
      } catch (err) {
        console.error("[packs] mint after the reveal failed", err);
        setMintNote(
          `${txErrorText(err, "The mint did not go through.")} Mint from the wardrobe whenever you like.`,
        );
      } finally {
        setMinting(false);
      }
  }, [wallet, signAllTransactions]);

  /** Buys `count` of this pack sealed, in one approval. */
  const seal = useCallback(async (chosen: PackDef) => {
    if (!wallet) return;
    if (!signAllTransactions) { setError(NO_SIGNER_MSG); return; }
    if (mismatch) { setError(mismatch); return; }
    if (!config) { setError(LOADING_MSG); return; }
    if (!mintConfig) { setError(MINT_NOT_READY_MSG); return; }
    const onChain = config.packs.find((p) => p.id === chosen.onChainId);
    if (!onChain) { setError("This pack is not on sale yet."); return; }
    const why = buyerIsTreasury(config, new PublicKey(wallet))
      ? TREASURY_WALLET_MSG
      : packUnavailableReason(onChain, config);
    if (why) { setError(why); return; }
    // Before the wallet opens: a wallet with no currency account failed in the
    // program with a bare "InvalidAccountData".
    const short = await fundsShortfall(baseConnection(), new PublicKey(wallet), config, onChain, count);
    if (short) { setError(short); return; }

    setSealing(chosen.onChainId);
    setError(null);
    try {
      await buySealedPacks({
        wallet: new PublicKey(wallet), pack: onChain, config, mintConfig,
        count, signAllTransactions,
      });
      // The indexer needs a moment to see a brand new leaf, so the list is
      // re-read rather than guessed at.
      // The pack goes somewhere, so show where. Switching the tab IS the
      // answer to "where did it go", and it is a better answer than a line
      // of text saying the same thing.
      setTab("mine");
      setTimeout(() => void refreshSealed(mintConfig), 2500);
    } catch (err) {
      setError(txErrorText(err, "The purchase failed."));
    } finally {
      setSealing(null);
    }
  }, [wallet, signAllTransactions, mismatch, config, mintConfig, count, refreshSealed]);

  /** Burns one sealed pack and waits for its reveal. */
  const openSealed = useCallback(async (entry: { assetId: PublicKey; packId: number; nonce: number }) => {
    if (!wallet) return;
    if (!signAllTransactions) { setError(NO_SIGNER_MSG); return; }
    if (mismatch) { setError(mismatch); return; }
    if (!config) { setError(LOADING_MSG); return; }
    if (!mintConfig) { setError(MINT_NOT_READY_MSG); return; }
    const onChain = config.packs.find((p) => p.id === entry.packId);
    if (!onChain) { setError("That pack is not one this city knows."); return; }
    const card = PACKS.find((p) => p.onChainId === entry.packId) ?? PACKS[0];

    setPack(card);
    setPhase("opening");
    setError(null);
    try {
      const { presignedMints, leftover, before } = await openSealedPack({
        wallet: new PublicKey(wallet), assetId: entry.assetId, nonce: entry.nonce,
        pack: onChain, mintConfig, signAllTransactions,
      });
      // The same wait a bought-and-opened pack gets, then the same reveal
      // and the same mint, because from the oracle's side nothing differs.
      // `before` was read before the burn was sent: read here, after it had
      // confirmed, a quick oracle could already be in it.
      const conn = baseConnection();
      const me = new PublicKey(wallet);
      const { granted, timedOut } = await awaitDraw(conn, me, before);
      if (timedOut) {
        setError("Opened, but the draw has not landed yet. It will appear in your wardrobe.");
        setStuck(true);
        setPhase("choose");
        return;
      }
      const owed = [...leftover, ...granted];
      await revealAndMint(granted, conn, me, presignedMints, owed, before);
      void refreshSealed(mintConfig);
    } catch (err) {
      // The whole error, logs and code included, for whoever opens the console.
      console.error("[packs] opening a sealed pack failed", err);
      setError(txErrorText(err, "That pack would not open."));
      setPhase("choose");
    }
  }, [wallet, signAllTransactions, mismatch, config, mintConfig, refreshSealed, revealAndMint]);
  const laterFeel = useButtonFeel();
  const anotherFeel = useButtonFeel();
  const doneFeel = useButtonFeel();

  // The price on a pack's card. With the paid draw on it is what the program
  // charges, in its own currency (USDC, 6 decimals): the card used to show
  // the preview's fixed SOL figure while the wallet was asked for USDC.
  const packPriceLabel = (p: PackDef): string => {
    if (BOOSTER_ONCHAIN) {
      const onChain = config?.packs.find((x) => x.id === p.onChainId);
      return onChain ? `${(Number(onChain.price) / 1e6).toFixed(2)} USDC` : "...";
    }
    return `${p.priceSol} SOL`;
  };

  // The latest openOnChain, which is declared below this and closes over the
  // current config and signer. Called through a ref so `open` never runs a
  // stale copy from the first render, when the config was still null.
  const openOnChainRef = useRef<((chosen: PackDef, fresh?: PackConfigAccount) => Promise<void>) | undefined>(undefined);
  const open = useCallback((chosen: PackDef) => {
    if (!wallet) return;
    setPack(chosen);
    setPhase("opening");
    setError(null);
    if (BOOSTER_ONCHAIN) {
      // Never the free preview for a connected wallet while the paid draw is
      // on. It used to fall through to it silently whenever the config had
      // not loaded yet or the wallet offered no signer: the pack "opened",
      // nothing asked for a signature, and the items lived only in this
      // browser, so everyone else saw the player without them (devnet,
      // 2026-11-05). Say what is missing instead.
      if (!signAllTransactions) {
        setError(NO_SIGNER_MSG);
        setPhase("choose");
        return;
      }
      if (mismatch) {
        setError(mismatch);
        setPhase("choose");
        return;
      }
      // Whatever has not loaded is read now rather than waited for, and a
      // failure says WHY: a shop that sat on "still loading" told nobody
      // anything (devnet, 2026-11-05).
      void (async () => {
        try {
          const conn = baseConnection();
          const cfg = config ?? await readPackConfig(conn);
          if (!cfg) {
            setError("The shop is not set up on this network yet.");
            setPhase("choose");
            return;
          }
          if (!config) setConfig(cfg);
          // No mint config means the items could be paid for and never
          // minted, and an unminted item cannot be worn, so the sale is
          // refused (devnet, 2026-11-05: "5 still to mint" after a paid pack).
          const mc = mintConfig ?? await readMintConfig(conn);
          if (!mc) { setError(MINT_NOT_READY_MSG); setPhase("choose"); return; }
          if (!mintConfig) setMintConfig(mc);
          await openOnChainRef.current?.(chosen, cfg);
        } catch (err) {
          setError(`Couldn't reach the shop: ${String((err as Error)?.message ?? err).split("\n")[0].slice(0, 120)}`);
          setPhase("choose");
        }
      })();
      return;
    }
    setError("Packs are not available in this build.");
    setPhase("choose");
  }, [wallet, config, mintConfig, signAllTransactions, mismatch]);

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
  const openOnChain = useCallback(async (chosen: PackDef, fresh?: PackConfigAccount) => {
    const cfgNow = fresh ?? config;
    if (!wallet || !signAllTransactions || !cfgNow) return;
    const onChain = cfgNow.packs.find((p) => p.id === chosen.onChainId);
    if (!onChain) { setError("This pack is not on sale yet."); setPhase("choose"); return; }
    const why = buyerIsTreasury(cfgNow, new PublicKey(wallet))
      ? TREASURY_WALLET_MSG
      : packUnavailableReason(onChain, cfgNow);
    if (why) { setError(why); setPhase("choose"); return; }
    // Before the wallet opens: a wallet with no currency account failed in the
    // program with a bare "InvalidAccountData" (devnet, 2026-11-05).
    const short = await fundsShortfall(baseConnection(), new PublicKey(wallet), cfgNow, onChain, count);
    if (short) { setError(short); setPhase("choose"); return; }

    try {
      const conn = baseConnection();
      const result = await buyPack({
        conn, wallet: new PublicKey(wallet), signAllTransactions, pack: onChain, config: cfgNow,
        count,
      });
      if (result.timedOut) {
        setError("Paid, but the draw has not landed yet. It will appear in your wardrobe.");
        setStuck(true);
        setPhase("choose");
        return;
      }
      await revealAndMint(
        result.granted, conn, new PublicKey(wallet), result.presignedMints, result.owed,
        new Set(result.ownedBefore),
      );
    } catch (err) {
      // The wallet's own message is the useful one: "insufficient funds",
      // "User rejected the request".
      console.error("[packs] open now failed", err);
      setError(txErrorText(err, "The purchase failed."));
      setPhase("choose");
    }
  }, [wallet, signAllTransactions, mismatch, config, count, revealAndMint]);
  openOnChainRef.current = openOnChain;


  /**
   * Asks the oracle again for the stuck draw, then reveals it like any other.
   *
   * The pack and its odds are the ones frozen when it was paid for; nothing is
   * charged. The mint is not pre-signed here, so settleMints asks for it, which
   * is acceptable on a path that only exists because something went wrong.
   */
  const retryStuck = useCallback(async () => {
    if (!wallet || !signAllTransactions || retrying) return;
    if (mismatch) { setError(mismatch); return; }
    setRetrying(true);
    setError(null);
    try {
      const conn = baseConnection();
      const me = new PublicKey(wallet);
      const { granted, ownedBefore, timedOut, packId } = await retryStuckDraw({
        conn, wallet: me, signAllTransactions,
      });
      if (timedOut) {
        setError("Asked again, and the oracle is still quiet. Try once more in a minute.");
        return;
      }
      setStuck(false);
      if (granted.length > 0) {
        setPack(PACKS.find((p) => p.onChainId === packId) ?? PACKS[0]);
        await revealAndMint(granted, conn, me, null, granted, new Set(ownedBefore));
      }
    } catch (err) {
      setError(txErrorText(err, "Could not ask again."));
    } finally {
      setRetrying(false);
    }
  }, [wallet, signAllTransactions, mismatch, retrying, revealAndMint]);

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
          SEASON {CURRENT_SEASON}{BOOSTER_ONCHAIN ? "" : " · PREVIEW"} · RANDOMNESS → MAGICBLOCK VRF
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
            {BOOSTER_ONCHAIN && stuck && (
              <div style={{
                fontSize: 8, color: "#ffd479", lineHeight: 1.8,
                padding: "8px 10px", marginBottom: 12,
                border: "1px solid #ffd479",
                background: "rgba(255,212,121,0.08)",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              }}>
                <span>A pack you paid for is still waiting on the oracle. Nothing is lost.</span>
                <button
                  disabled={retrying}
                  onClick={() => void retryStuck()}
                  style={{
                    fontFamily: "inherit", fontSize: 8, padding: "4px 10px",
                    border: "1px solid #ffd479", background: "transparent",
                    color: retrying ? "#6f7696" : "#ffd479",
                    cursor: retrying ? "default" : "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {retrying ? "ASKING…" : "ASK AGAIN"}
                </button>
              </div>
            )}
            {BOOSTER_ONCHAIN && balance !== null && balance === BigInt(0) && (
              <div style={{ fontSize: 8, color: "#aaaacc", lineHeight: 1.8, marginBottom: 12 }}>
                This wallet has no balance in the currency packs are priced in.
              </div>
            )}
            {/* TWO HALVES OF A SHOP: what is for sale, and what is already
                yours.
                The second one is a tab and not a shelf under the first,
                because a sealed pack may have come from a marketplace or
                from a friend. Somebody arriving to look for it has to find
                the place BEFORE they own anything, so this is here whether
                the shelf is empty or not. */}
            <div style={{
              display: "flex", gap: 0, marginBottom: 14,
              borderBottom: "1px solid #2a2a44",
            }}>
              {([["buy", "BUY"], ["mine", "YOUR PACKS"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{
                    fontFamily: "inherit", fontSize: 8, padding: "8px 14px",
                    cursor: "pointer", background: "transparent", border: "none",
                    borderBottom: `2px solid ${tab === key ? "#14F195" : "transparent"}`,
                    color: tab === key ? "#14F195" : "#aaaacc",
                  }}
                >
                  {label}
                  {/* The count is the whole reason to look, so it is on the
                      tab rather than behind it. */}
                  {key === "mine" && sealed !== null && sealed.length > 0 && ` (${sealed.length})`}
                </button>
              ))}
            </div>

            {tab === "buy" ? (
              <>
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
                    priceLabel={packPriceLabel(p)}
                    onOpen={() => open(p)}
                    onSeal={() => void seal(p)}
                    sealing={sealing === p.onChainId}
                  />
                ))}
              </div>
              </>
            ) : (
              <MyPacks
                sealed={sealed}
                busy={sealedBusy}
                onOpen={(entry) => void openSealed(entry)}
                onRetry={() => void refreshSealed(mintConfig)}
              />
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
            {!minting && mintedAll && (
              <div style={{ fontSize: 8, color: "#14F195", marginBottom: 10 }}>
                MINTED
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
                    // Neutral, because the frame inside is the rarity now.
                    // Two borders of one colour around one item reads as a
                    // mistake, and the drawn one is the better of the two.
                    background: "rgba(255,255,255,0.02)",
                    border: "2px solid rgba(255,255,255,0.08)",
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
                      the item, not the character it sits on.

                      The frame says the rarity in colour and the label below
                      says it in words, ON PURPOSE. The colour is the faster
                      read once you know it, and nobody knows it the first
                      time: the written line is what teaches the colour, so
                      it stays even though it looks redundant. */}
                  <RarityFrame kind={d.rarity} size={REVEAL_TILE}>
                    <ChromaPreview
                      file={d.file}
                      size={innerSize(REVEAL_TILE)}
                      facingUp={showsFromBehind(d.category, getVariant(d.category, d.id))}
                      crop
                    />
                  </RarityFrame>
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
                  }}>{d.owned ? "REPEAT" : "NEW"}</span>
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
function PackCard({ pack, priceLabel, onOpen, onSeal, sealing }: {
  pack: PackDef;
  /** What one pack costs: the on-chain price when the paid draw is on. */
  priceLabel: string;
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
        {pack.size} PIECES · {priceLabel}
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
/**
 * The packs this wallet is holding unopened.
 *
 * ── Why `sealed` may be null ────────────────────────────────────────────
 *
 * These are ordinary assets, so the only way to find them is to ask the
 * indexer, and the indexer can be down. Null means we could not find out,
 * which is a different sentence from "you have none" and has to read like
 * one: somebody holding three packs must never be shown an empty shelf.
 */
function MyPacks({ sealed, busy, onOpen, onRetry }: {
  sealed: { assetId: PublicKey; packId: number; nonce: number }[] | null;
  busy: boolean;
  onOpen: (entry: { assetId: PublicKey; packId: number; nonce: number }) => void;
  onRetry: () => void;
}) {
  const note = (text: string) => (
    <div style={{ fontSize: 8, color: "#aaaacc", lineHeight: 1.8, padding: "24px 0" }}>
      {text}
    </div>
  );

  if (busy && sealed === null) return note("Looking for your packs.");

  if (sealed === null) {
    return (
      <div style={{ padding: "18px 0" }}>
        {note("Could not reach the indexer, so this list is unknown. Your packs are safe.")}
        <button
          onClick={onRetry}
          style={chamferBox(8, {
            fontFamily: "inherit", fontSize: 8, padding: "8px 16px", cursor: "pointer",
            background: "transparent", color: "#aaaacc", border: "1px solid #3a3a55",
          })}
        >TRY AGAIN</button>
      </div>
    );
  }

  if (sealed.length === 0) {
    return note("Nothing sealed yet. Buy a pack sealed, or pick one up anywhere, and it waits here.");
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))",
        gap: 10, marginBottom: 10,
      }}>
        {sealed.map((entry) => {
          const card = PACKS.find((c) => c.onChainId === entry.packId);
          const accent = card?.accent ?? "#aaaacc";
          return (
            <button
              key={entry.assetId.toBase58()}
              onClick={() => onOpen(entry)}
              style={chamferBox(10, {
                fontFamily: '"Press Start 2P", monospace', fontSize: 7,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                padding: "12px 8px", cursor: "pointer",
                background: "rgba(255,255,255,0.03)",
                color: accent,
                border: `1px solid ${accent}66`,
              })}
            >
              {/* The pack's own art, so the shelf looks like the shop it came
                  from. A pack id this build has never heard of still shows,
                  because refusing to draw it would hide a real asset. */}
              {card ? <PackArt pack={card} scale={2} /> : null}
              <span>{card?.name ?? `PACK ${entry.packId}`}</span>
              <span style={{ color: "#d0d0f0" }}>OPEN</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 6, color: "#7a7aa0", lineHeight: 1.5 }}>
        Opening burns the pack. What is inside is drawn at that moment, not before.
      </div>
    </div>
  );
}

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
