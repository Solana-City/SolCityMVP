"use client";

/**
 * "X challenges you" — the card that appears in the city when another player
 * invites this wallet to a friendly Sol Mechs duel.
 *
 * The invite lives on the challenger's transaction (a one-slot mailbox on this
 * wallet's duelist account), so the watcher here is read-only: no session key,
 * no popup, nothing sent until the player accepts. DECLINE just dismisses it;
 * the invite expires on its own after two minutes.
 */
import { useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { watchIncomingDuel, type IncomingDuel } from "@/game/solmechs/pvp/chain/challengeWatch";
import { DUEL_INVITE_EVENT } from "@/ui/PlayerCard";
import { cachedName, onNames, requestNames } from "@/game/names/nameService";
import { Bust } from "@/game/minigames/sol-mechs/SquadPortraits";
import { PRESET_BUILDS } from "@/game/solmechs/data/catalog";
import { track } from "@/game/telemetry/track";

const PIX = '"Press Start 2P", monospace';

function shortWallet(wallet: string): string {
  return wallet.length > 10 ? `${wallet.slice(0, 4)}...${wallet.slice(-4)}` : wallet;
}

export default function DuelInvite({ wallet }: { wallet: string | null }) {
  const [invite, setInvite] = useState<IncomingDuel | null>(null);
  const [name, setName] = useState<string | null>(null);
  const dismissed = useRef<string | null>(null);

  useEffect(() => {
    if (!wallet) { setInvite(null); return; }
    let key: PublicKey;
    try { key = new PublicKey(wallet); } catch { return; }
    return watchIncomingDuel(key, (next) => {
      if (next && dismissed.current === `${next.challenger}:${next.at}`) return;
      setInvite(next);
    });
  }, [wallet]);

  // The challenger's nickname, once the name service knows it.
  useEffect(() => {
    if (!invite) { setName(null); return; }
    setName(cachedName(invite.challenger));
    requestNames([invite.challenger]);
    return onNames((names) => {
      const found = names[invite.challenger];
      if (found) setName(found);
    });
  }, [invite]);

  if (!invite) return null;
  const who = name ?? shortWallet(invite.challenger);

  const accept = () => {
    track("duel", "accept", { value: 1, label: "accepted a duel" });
    window.dispatchEvent(new CustomEvent(DUEL_INVITE_EVENT, {
      detail: { kind: "accept", opponent: invite.challenger, name: who },
    }));
    setInvite(null);
  };

  const decline = () => {
    dismissed.current = `${invite.challenger}:${invite.at}`;
    setInvite(null);
  };

  return (
    <div style={{
      position: "fixed", zIndex: 70,
      left: "50%", transform: "translateX(-50%)",
      bottom: "max(env(safe-area-inset-bottom, 0px), 16px)",
      width: "min(340px, calc(100vw - 24px))",
      padding: "12px 14px", borderRadius: 14,
      background: "rgba(10,12,24,0.95)",
      border: "1px solid rgba(20,241,149,0.45)",
      boxShadow: "0 10px 40px rgba(0,0,0,0.55)",
      fontFamily: PIX, color: "#d0d0f0",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ flexShrink: 0, lineHeight: 0 }}>
        <Bust build={PRESET_BUILDS.titan} size={34} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 7, color: "#14F195", marginBottom: 4 }}>DUEL INVITE</div>
        <div style={{ fontSize: 8, lineHeight: 1.5 }}>{who} wants a 3v3</div>
      </div>
      <button
        onClick={accept}
        style={{
          fontFamily: PIX, fontSize: 7, padding: "9px 10px", borderRadius: 8, border: "none",
          background: "#14F195", color: "#04140c", cursor: "pointer", flexShrink: 0,
        }}
      >
        FIGHT
      </button>
      <button
        onClick={decline}
        aria-label="Decline"
        style={{
          fontFamily: PIX, fontSize: 7, padding: "9px 8px", borderRadius: 8,
          background: "transparent", border: "1px solid rgba(139,139,167,0.4)",
          color: "#8b8ba7", cursor: "pointer", flexShrink: 0,
        }}
      >
        LATER
      </button>
    </div>
  );
}
