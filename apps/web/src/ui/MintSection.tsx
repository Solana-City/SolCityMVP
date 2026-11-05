"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { itemAtGlobalIndex, BOOSTER_BLOCK_START } from "@/game/config/catalogIndex";
import { getVariant } from "@/game/config/paperDoll";
import { rarityOf, RARITY_COLOR } from "@/game/config/packs";
import { baseConnection, ownedIndices, hasPendingDraw } from "@/game/solana/packs";
import { readMintConfig, type MintConfigAccount } from "@/game/solana/mint";
import { heldCosmetics, claimCosmetic, type HeldCosmetic } from "@/game/solana/claim";
import { syncOwnedToWardrobe } from "@/game/solana/packs";
import { getNetwork } from "@/game/multiplayer/OnChainMultiplayer";
import { claimableDrops, claimEventDrop, type ClaimableDrop } from "@/game/solana/eventDrops";

/**
 * Turning cosmetics you own into assets you hold.
 *
 * Shows nothing at all until minting is set up on chain: `readMintConfig`
 * returns null until the collection and tree exist, and a button that can only
 * fail is worse than no button. It switches itself on the moment the setup
 * script has run. The one exception is an event reward to claim, which needs
 * the drop and not the mint.
 *
 * Only pack items are offered. Free and quest cosmetics are below
 * BOOSTER_BLOCK_START, and the program refuses to mint them for the reason
 * they exist: they are not scarce, so an asset for one would say nothing.
 *
 * The player pays. A compressed mint is a transaction fee and nothing else,
 * which is the whole reason the pack economy went with cNFTs.
 *
 * And the other direction: a cosmetic BOUGHT from somebody else is in the
 * wallet but not in our program, so nobody sees you wear it until it is
 * claimed. Claiming is one approval, and it also takes the right to wear that
 * item away from whoever held it before (audit R-21): one asset, one wearer.
 *
 * And event rewards: a wallet on an event's winners list claims the cosmetic
 * here, one approval, and from then on it is wearable and mintable like any
 * pack item. See eventDrops.ts.
 */
export default function MintSection({ wallet }: { wallet: string | null }) {
  const { signTransaction } = useWallet();
  const [config, setConfig] = useState<MintConfigAccount | null>(null);
  const [owned, setOwned] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A pack still waiting on the oracle. The program refuses a mint while it
  // waits, since the mint would take the room the draw was paid for, so the
  // buttons say so instead of failing in the wallet.
  const [drawPending, setDrawPending] = useState(false);
  // Held in the wallet, not yet known to the program: bought elsewhere.
  const [claimable, setClaimable] = useState<HeldCosmetic[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  // Event rewards this wallet won and has not claimed yet.
  const [drops, setDrops] = useState<ClaimableDrop[]>([]);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    try {
      const conn = baseConnection();
      const key = new PublicKey(wallet);
      const nowOwned = await ownedIndices(conn, key);
      setOwned(nowOwned);
      setDrawPending(await hasPendingDraw(conn, key));
      // Before the mint check: claiming an event reward does not need minting
      // to be set up, only the drop.
      claimableDrops(conn, key, nowOwned).then(setDrops).catch(() => setDrops([]));
      const cfg = await readMintConfig(conn);
      setConfig(cfg);
      if (!cfg) return;
      // Not awaited into the rest: an indexer that is down leaves the claim
      // list empty and nothing else.
      heldCosmetics(conn, key, cfg)
        .then((held) => setClaimable(held.filter(
          (h) => h.index >= BOOSTER_BLOCK_START && !nowOwned.includes(h.index),
        )))
        .catch(() => setClaimable([]));
    } catch {
      // An unreachable RPC shows nothing rather than an empty wardrobe: the
      // player owns what they own, and this panel is not the record of it.
    }
  }, [wallet]);

  useEffect(() => { void refresh(); }, [refresh]);

  const claim = useCallback(async (item: HeldCosmetic) => {
    if (!wallet || !signTransaction || !config) return;
    setClaiming(item.assetId.toBase58());
    setError(null);
    try {
      const conn = baseConnection();
      const key = new PublicKey(wallet);
      const { previousHolder } = await claimCosmetic({
        conn, wallet: key, item, config, signTransaction,
      });
      // Wearable now: into the wardrobe's view and the program's snapshot.
      await syncOwnedToWardrobe(conn, key);
      void getNetwork()?.refreshUnlockSnapshot();
      // And off the previous holder, whose snapshot otherwise keeps it.
      if (previousHolder) void getNetwork()?.syncUnlocksFor(previousHolder);
      await refresh();
    } catch (err) {
      setError((err as Error).message?.split("\n")[0] ?? "The claim failed.");
    } finally {
      setClaiming(null);
    }
  }, [wallet, signTransaction, config, refresh]);

  const claimDrop = useCallback(async (drop: ClaimableDrop) => {
    if (!wallet || !signTransaction) return;
    setClaiming(`drop:${drop.id}`);
    setError(null);
    try {
      const conn = baseConnection();
      const key = new PublicKey(wallet);
      await claimEventDrop({ conn, wallet: key, drop, signTransaction });
      // Wearable now, as after any claim: the wardrobe's view and the snapshot
      // the program checks outfits against.
      await syncOwnedToWardrobe(conn, key);
      void getNetwork()?.refreshUnlockSnapshot();
      await refresh();
    } catch (err) {
      setError((err as Error).message?.split("\n")[0] ?? "The claim failed.");
    } finally {
      setClaiming(null);
    }
  }, [wallet, signTransaction, refresh]);

  if (!wallet || (!config && drops.length === 0)) return null;

  // Only what needs a decision here: an event reward to claim, or an asset
  // bought elsewhere to make wearable. Pack items whose mint did not land are
  // no longer listed: they read "MINT NOW" on their own wardrobe tile
  // (owner, 2026-11-05), so this section stays out of the way otherwise.
  if (claimable.length === 0 && drops.length === 0) return null;

  return (
    <div style={{ marginTop: 14, fontSize: 8, lineHeight: 1.8 }}>
      <div style={{ color: "#aaaacc", marginBottom: 8 }}>
        COLLECTIBLES
      </div>

      {error && (
        <div style={{
          color: "#ff9aa6", padding: "6px 8px", marginBottom: 8,
          border: "1px solid #ff9aa6", background: "rgba(255,154,166,0.08)",
        }}>{error}</div>
      )}

      {drops.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          <div style={{ color: "#ffd479" }}>EVENT REWARD{drops.length > 1 ? "S" : ""} TO CLAIM</div>
          {drops.map((drop) => {
            const entry = itemAtGlobalIndex(drop.index);
            if (!entry) return null;
            const variant = getVariant(entry.category, entry.variant.id);
            const rarity = rarityOf(entry.category, entry.variant.id);
            const key = `drop:${drop.id}`;
            return (
              <div key={key} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10, padding: "6px 8px", background: "rgba(255,212,121,0.06)",
              }}>
                <span>
                  <span style={{ color: RARITY_COLOR[rarity] }}>■{" "}</span>
                  {variant?.name ?? entry.variant.id}
                </span>
                <button
                  disabled={claiming !== null || drawPending}
                  onClick={() => void claimDrop(drop)}
                  style={{
                    fontSize: 8, padding: "4px 10px", cursor: claiming ? "default" : "pointer",
                    border: "1px solid #ffd479", background: "transparent",
                    color: claiming === key ? "#6f7696" : "#ffd479",
                    fontFamily: "inherit",
                  }}
                >
                  {claiming === key ? "CLAIMING…" : "CLAIM"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {drawPending && drops.length > 0 && (
        <div style={{ color: "#ffd479", marginBottom: 8 }}>
          A pack is still being drawn. Claiming opens again once it lands.
        </div>
      )}

      {claimable.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          <div style={{ color: "#aaaacc" }}>IN YOUR WALLET, NOT YET WEARABLE</div>
          {claimable.map((item) => {
            const entry = itemAtGlobalIndex(item.index);
            if (!entry) return null;
            const variant = getVariant(entry.category, entry.variant.id);
            const rarity = rarityOf(entry.category, entry.variant.id);
            const key = item.assetId.toBase58();
            return (
              <div key={key} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10, padding: "6px 8px", background: "rgba(255,255,255,0.03)",
              }}>
                <span>
                  <span style={{ color: RARITY_COLOR[rarity] }}>■{" "}</span>
                  {variant?.name ?? entry.variant.id}
                </span>
                <button
                  disabled={claiming !== null || drawPending}
                  onClick={() => void claim(item)}
                  style={{
                    fontSize: 8, padding: "4px 10px", cursor: claiming ? "default" : "pointer",
                    border: "1px solid #ffd479", background: "transparent",
                    color: claiming === key ? "#6f7696" : "#ffd479",
                    fontFamily: "inherit",
                  }}
                >
                  {claiming === key ? "CLAIMING…" : "WEAR IT"}
                </button>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
