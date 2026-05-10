"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { NPCDefinition, NPCAction } from "@/game/config/npcRegistry";
import { usePinchZoom } from "@/ui/usePinchZoom";

// All Solana/wallet-adapter code must be client-only — these packages
// access `window`/`navigator` at module-load time and crash the SSR pass.
const SolanaProvider = dynamic(() => import("@/ui/SolanaProvider"), { ssr: false });
const PhaserGame    = dynamic(() => import("@/game/PhaserGame"),    { ssr: false });
const WalletBar           = dynamic(() => import("@/ui/WalletBar"),           { ssr: false });
const ChatPanel           = dynamic(() => import("@/ui/ChatPanel"),           { ssr: false });
const NPCDialog           = dynamic(() => import("@/ui/NPCDialog"),           { ssr: false });
const ActionPanel         = dynamic(() => import("@/ui/ActionPanel"),         { ssr: false });
const ProfilePanel        = dynamic(() => import("@/ui/ProfilePanel"),        { ssr: false });
const TransactionLogPanel = dynamic(() => import("@/ui/TransactionLogPanel"), { ssr: false });
const ToastStack          = dynamic(() => import("@/ui/ToastStack"),          { ssr: false });
const HUD                 = dynamic(() => import("@/ui/HUD"),                 { ssr: false });
const WalletSignBridge    = dynamic(() => import("@/ui/WalletSignBridge"),    { ssr: false });
const MobileControls      = dynamic(() => import("@/ui/MobileControls"),      { ssr: false });
const ZoomControl         = dynamic(() => import("@/ui/ZoomControl"),         { ssr: false });

export default function Home() {
  const [game, setGame] = useState<Phaser.Game | null>(null);
  const [activeNPC, setActiveNPC] = useState<NPCDefinition | null>(null);
  const [activeAction, setActiveAction] = useState<NPCAction | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // Chat hidden by default on touch devices, visible on desktop
  const [chatOpen, setChatOpen] = useState(() =>
    typeof window === "undefined"
      ? true
      : !window.matchMedia("(pointer: coarse)").matches
  );

  usePinchZoom();

  useEffect(() => {
    if (!game) return;
    const handler = (npc: NPCDefinition) => setActiveNPC(npc);
    game.events.on("npc:interact", handler);
    return () => { game.events.off("npc:interact", handler); };
  }, [game]);

  const handleDialogClose = useCallback(() => {
    setActiveNPC(null);
    game?.events.emit("npc:close");
  }, [game]);

  const handleAction = useCallback((action: NPCAction) => {
    setActiveNPC(null);
    if (action.type === "placeholder") {
      game?.events.emit("npc:close");
      return;
    }
    if (action.type === "link") {
      if (action.url) window.open(action.url, "_blank", "noopener,noreferrer");
      game?.events.emit("npc:close");
      return;
    }
    setActiveAction(action);
  }, [game]);

  const handleActionClose = useCallback(() => {
    setActiveAction(null);
    game?.events.emit("npc:close");
  }, [game]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "p" || e.key === "P") {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
        setProfileOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleWalletChange = useCallback((wallet: string | null) => {
    if (!game) return;
    if (wallet) {
      game.events.emit("wallet:connected", wallet);
    } else {
      game.events.emit("wallet:disconnected");
    }
  }, [game]);

  return (
    <SolanaProvider>
      {/* Headless bridge so Phaser can request wallet signatures */}
      <WalletSignBridge />
      <main className="w-screen h-screen relative">
        <PhaserGame onGameReady={setGame} />

        {/* Score HUD — top left */}
        <HUD />

        {/* Top-right cluster: PFP + wallet + tx log + zoom */}
        <div className="fixed top-4 right-4 z-20 flex flex-col items-end gap-2">
          <PfpButton gameRef={game} onClick={() => setProfileOpen(true)} />
          <WalletBar onWalletChange={handleWalletChange} />
          <TransactionLogPanel
            isOpen={logOpen}
            onToggle={() => setLogOpen((v) => !v)}
          />
          <ZoomControl />
        </div>

        <ToastStack />
        <MobileControls gameRef={game} chatOpen={chatOpen} onChatToggle={() => setChatOpen((v) => !v)} />
        <ChatPanel gameRef={game} visible={chatOpen} />
        <NPCDialog npc={activeNPC} onClose={handleDialogClose} onAction={handleAction} />
        <ActionPanel action={activeAction} onClose={handleActionClose} />
        <ProfilePanel gameRef={game} isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
      </main>
    </SolanaProvider>
  );
}

function PfpButton({ gameRef, onClick }: { gameRef: Phaser.Game | null; onClick: () => void }) {
  const [pfp, setPfp] = useState<string | null>(null);
  const [initial, setInitial] = useState("C");

  useEffect(() => {
    if (!gameRef) return;
    const check = setInterval(() => {
      const scene = gameRef.scene.getScene("CityScene");
      if (scene) {
        const pm = scene.registry.get("profileManager") as any;
        if (pm) {
          const p = pm.get();
          setPfp(p.pfp);
          setInitial(p.displayName[0]?.toUpperCase() ?? "C");
          pm.onChange((prof: any) => {
            setPfp(prof.pfp);
            setInitial(prof.displayName[0]?.toUpperCase() ?? "C");
          });
          clearInterval(check);
        }
      }
    }, 200);
    return () => clearInterval(check);
  }, [gameRef]);

  return (
    <button
      onClick={onClick}
      className="rounded-full cursor-pointer transition-transform hover:scale-105"
      style={{
        width: 48,
        height: 48,
        border: "2px solid #9945FF",
        background: pfp ? "transparent" : "rgba(153,69,255,0.15)",
        padding: 0,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      title="Profile [P]"
    >
      {pfp ? (
        <img src={pfp} alt="PFP" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ color: "#9945FF", fontSize: "18px", fontWeight: "bold" }}>{initial}</span>
      )}
    </button>
  );
}
