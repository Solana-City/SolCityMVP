"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import SolanaProvider from "@/ui/SolanaProvider";
import WalletBar from "@/ui/WalletBar";
import ChatPanel from "@/ui/ChatPanel";
import NPCDialog from "@/ui/NPCDialog";
import ActionPanel from "@/ui/ActionPanel";
import type { NPCDefinition, NPCAction } from "@/game/config/npcRegistry";

const PhaserGame = dynamic(() => import("@/game/PhaserGame"), { ssr: false });

export default function Home() {
  const [game, setGame] = useState<Phaser.Game | null>(null);
  const [activeNPC, setActiveNPC] = useState<NPCDefinition | null>(null);
  const [activeAction, setActiveAction] = useState<NPCAction | null>(null);

  useEffect(() => {
    if (!game) return;
    const handler = (npc: NPCDefinition) => {
      setActiveNPC(npc);
    };
    game.events.on("npc:interact", handler);
    return () => {
      game.events.off("npc:interact", handler);
    };
  }, [game]);

  const handleDialogClose = useCallback(() => {
    setActiveNPC(null);
    game?.events.emit("npc:close");
  }, [game]);

  const handleAction = useCallback((action: NPCAction) => {
    setActiveNPC(null);
    setActiveAction(action);
  }, []);

  const handleActionClose = useCallback(() => {
    setActiveAction(null);
    game?.events.emit("npc:close");
  }, [game]);

  return (
    <SolanaProvider>
      <main className="w-screen h-screen relative">
        <PhaserGame onGameReady={setGame} />
        <WalletBar />
        <ChatPanel gameRef={game} />
        <NPCDialog
          npc={activeNPC}
          onClose={handleDialogClose}
          onAction={handleAction}
        />
        <ActionPanel action={activeAction} onClose={handleActionClose} />
      </main>
    </SolanaProvider>
  );
}
