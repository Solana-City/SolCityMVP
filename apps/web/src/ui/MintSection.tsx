"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { itemAtGlobalIndex, BOOSTER_BLOCK_START } from "@/game/config/catalogIndex";
import { getVariant } from "@/game/config/paperDoll";
import { rarityOf, RARITY_COLOR } from "@/game/config/packs";
import { baseConnection, ownedIndices } from "@/game/solana/packs";
import { readMintConfig, mintedIndices, mintCosmetic, type MintConfigAccount } from "@/game/solana/mint";

/**
 * Turning cosmetics you own into assets you hold.
 *
 * Shows nothing at all until minting is set up on chain: `readMintConfig`
 * returns null until the collection and tree exist, and a button that can only
 * fail is worse than no button. It switches itself on the moment the setup
 * script has run.
 *
 * Only pack items are offered. Free and quest cosmetics are below
 * BOOSTER_BLOCK_START, and the program refuses to mint them for the reason
 * they exist: they are not scarce, so an asset for one would say nothing.
 *
 * The player pays. A compressed mint is a transaction fee and nothing else,
 * which is the whole reason the pack economy went with cNFTs.
 */
export default function MintSection({ wallet }: { wallet: string | null }) {
  const { signTransaction } = useWallet();
  const [config, setConfig] = useState<MintConfigAccount | null>(null);
  const [owned, setOwned] = useState<number[]>([]);
  const [minted, setMinted] = useState<number[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justMinted, setJustMinted] = useState<number[]>([]);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    try {
      const conn = baseConnection();
      const cfg = await readMintConfig(conn);
      setConfig(cfg);
      if (!cfg) return;
      const key = new PublicKey(wallet);
      setOwned(await ownedIndices(conn, key));
      setMinted(await mintedIndices(conn, key));
    } catch {
      // An unreachable RPC shows nothing rather than an empty wardrobe: the
      // player owns what they own, and this panel is not the record of it.
    }
  }, [wallet]);

  useEffect(() => { void refresh(); }, [refresh]);

  const mint = useCallback(async (index: number) => {
    if (!wallet || !signTransaction) return;
    setBusy(index);
    setError(null);
    try {
      await mintCosmetic({ wallet: new PublicKey(wallet), index, signTransaction });
      setMinted((m) => [...m, index]);
      setJustMinted((m) => [...m, index]);
    } catch (err) {
      setError((err as Error).message?.split("\n")[0] ?? "The mint failed.");
    } finally {
      setBusy(null);
    }
  }, [wallet, signTransaction]);

  if (!wallet || !config) return null;

  const mintable = owned
    .filter((i) => i >= BOOSTER_BLOCK_START && !minted.includes(i))
    .map((i) => ({ index: i, entry: itemAtGlobalIndex(i) }))
    .filter((x) => x.entry !== undefined);

  const held = minted.length;
  if (mintable.length === 0 && held === 0) return null;

  return (
    <div style={{ marginTop: 14, fontSize: 8, lineHeight: 1.8 }}>
      <div style={{ color: "#aaaacc", marginBottom: 8 }}>
        COLLECTIBLES
        {held > 0 && <span style={{ color: "#6f7696" }}>{"  "}{held} already yours</span>}
      </div>

      {error && (
        <div style={{
          color: "#ff9aa6", padding: "6px 8px", marginBottom: 8,
          border: "1px solid #ff9aa6", background: "rgba(255,154,166,0.08)",
        }}>{error}</div>
      )}

      {mintable.length === 0 ? (
        <div style={{ color: "#6f7696" }}>Every pack item you own is already an asset.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {mintable.map(({ index, entry }) => {
            const variant = getVariant(entry!.category, entry!.variant.id);
            const rarity = rarityOf(entry!.category, entry!.variant.id);
            return (
              <div key={index} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10, padding: "6px 8px", background: "rgba(255,255,255,0.03)",
              }}>
                <span>
                  <span style={{ color: RARITY_COLOR[rarity] }}>■{" "}</span>
                  {variant?.name ?? entry!.variant.id}
                </span>
                <button
                  disabled={busy !== null}
                  onClick={() => void mint(index)}
                  style={{
                    fontSize: 8, padding: "4px 10px", cursor: busy ? "default" : "pointer",
                    border: "1px solid #14F195", background: "transparent",
                    color: busy === index ? "#6f7696" : "#14F195",
                    fontFamily: "inherit",
                  }}
                >
                  {busy === index ? "MINTING…" : "MINT"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {justMinted.length > 0 && (
        <div style={{ color: "#14F195", marginTop: 8 }}>
          {justMinted.length} now in your wallet. Selling one does not take the
          outfit away, and whoever buys it can claim the right to wear it too.
        </div>
      )}
    </div>
  );
}
