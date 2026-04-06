"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import ChatPanel from "@/ui/ChatPanel";

const PhaserGame = dynamic(() => import("@/game/PhaserGame"), { ssr: false });

export default function Home() {
  const [game, setGame] = useState<Phaser.Game | null>(null);

  return (
    <main className="w-screen h-screen relative">
      <PhaserGame onGameReady={setGame} />
      <ChatPanel gameRef={game} />
    </main>
  );
}
