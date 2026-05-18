"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { NPCDefinition, NPCAction } from "@/game/config/npcRegistry";
import type { MiniGameContext, MiniGameResult } from "@/game/minigames/types";
import { launch as launchMiniGame } from "@/game/minigames";
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
const MiniGameOverlay     = dynamic(() => import("@/ui/MiniGameOverlay"),     { ssr: false });
const MwaRegistration     = dynamic(() => import("@/ui/MwaRegistration"),     { ssr: false });
const RotatePrompt        = dynamic(() => import("@/ui/RotatePrompt"),        { ssr: false });

import ErrorBoundary from "@/ui/ErrorBoundary";

function useIsTouch() {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isTouch;
}

export default function Home() {
  const [game, setGame] = useState<Phaser.Game | null>(null);
  const isTouch = useIsTouch();
  const [activeNPC, setActiveNPC] = useState<NPCDefinition | null>(null);
  const [activeAction, setActiveAction] = useState<NPCAction | null>(null);
  const [activeMiniGame, setActiveMiniGame] = useState<{ id: string; context: MiniGameContext } | null>(null);
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

  useEffect(() => {
    if (!game) return;
    const handler = (data: { id: string; context: MiniGameContext }) => setActiveMiniGame(data);
    game.events.on("minigame:launch", handler);
    return () => { game.events.off("minigame:launch", handler); };
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
    if (action.type === "minigame") {
      if (action.miniGameId) {
        // Build a stub context — PDAs are null until on-chain order accounts are wired in
        launchMiniGame(action.miniGameId, {
          wallet: null,
          cartPda:       null,
          orderPda:      null,
          orderType:     action.orderType ?? "sushi",
          expiresAt:     Math.floor(Date.now() / 1000) + 60,
          amountLamports: 10_000_000,
        });
        // Don't emit npc:close — CityScene is paused by minigame:launch;
        // minigame:close will resume it when the game ends.
      }
      return;
    }
    setActiveAction(action);
  }, [game]);

  const handleActionClose = useCallback(() => {
    setActiveAction(null);
    game?.events.emit("npc:close");
  }, [game]);

  const handleMiniGameClose = useCallback(() => {
    setActiveMiniGame(null);
    game?.events.emit("minigame:close");
  }, [game]);

  // Records result to the ephemeral rollup (session key, no popup), then closes.
  const handleMiniGameResult = useCallback(async (result: MiniGameResult) => {
    game?.events.emit("minigame:result", { success: result.success });
    handleMiniGameClose();
  }, [game, handleMiniGameClose]);

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
    <ErrorBoundary>
      <SolanaProvider>
        {/* Blocks the game canvas while the device is in portrait — Seeker/mobile */}
        <RotatePrompt />
        {/* Registers Mobile Wallet Adapter on Android/Seeker — no-op elsewhere */}
        <MwaRegistration />
        {/* Headless bridge so Phaser can request wallet signatures */}
        <WalletSignBridge />
        <main className="w-screen h-screen relative">
          <PhaserGame onGameReady={setGame} />

          {/* Score HUD — top left */}
          <HUD />

          {/* Top-right cluster: PFP + wallet + tx log + zoom */}
          <div
            className="fixed z-20 flex flex-col items-end gap-2"
            style={{
              top: "max(env(safe-area-inset-top, 0px), 12px)",
              right: "max(env(safe-area-inset-right, 0px), 12px)",
            }}
          >
            <PfpButton gameRef={game} onClick={() => setProfileOpen(true)} />
            <WalletBar onWalletChange={handleWalletChange} />
            {/* Desktop only — too much chrome on mobile */}
            {!isTouch && (
              <>
                <TransactionLogPanel
                  isOpen={logOpen}
                  onToggle={() => setLogOpen((v) => !v)}
                />
                <ZoomControl />
              </>
            )}
          </div>

          <ToastStack />
          <MobileControls gameRef={game} chatOpen={chatOpen} onChatToggle={() => setChatOpen((v) => !v)} />
          <ChatPanel gameRef={game} visible={chatOpen} />
          <NPCDialog npc={activeNPC} onClose={handleDialogClose} onAction={handleAction} />
          <ActionPanel action={activeAction} onClose={handleActionClose} />
          <ProfilePanel gameRef={game} isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
          {activeMiniGame && (
            <MiniGameOverlay
              id={activeMiniGame.id}
              context={activeMiniGame.context}
              onResult={handleMiniGameResult}
              onClose={handleMiniGameClose}
            />
          )}
        </main>
      </SolanaProvider>
    </ErrorBoundary>
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
