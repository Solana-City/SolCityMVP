"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { NPCDefinition, NPCAction } from "@/game/config/npcRegistry";
import type { MiniGameContext, MiniGameResult } from "@/game/minigames/types";
import { launch as launchMiniGame } from "@/game/minigames";
import { usePinchZoom } from "@/ui/usePinchZoom";
import { incrementQuest } from "@/game/quests/QuestManager";

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
const WardrobePanel       = dynamic(() => import("@/ui/WardrobePanel"),       { ssr: false });
const ConnectScreen       = dynamic(() => import("@/ui/ConnectScreen"),       { ssr: false });
const WhereIsNPCCard      = dynamic(() => import("@/ui/WhereIsNPCCard"),      { ssr: false });
const QuestPanel          = dynamic(() => import("@/ui/QuestPanel"),          { ssr: false });
const PlayerCard          = dynamic(() => import("@/ui/PlayerCard"),          { ssr: false });

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
  const [playerCardTarget, setPlayerCardTarget] = useState<{ wallet: string; displayName?: string } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"hunt" | "quests" | null>(null);
  // Wallet address that connected before the Phaser game was ready — replayed once game loads.
  const pendingWalletRef = useRef<string | null | undefined>(undefined);
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

  useEffect(() => {
    if (!game) return;
    const handler = (data: { wallet: string; displayName?: string }) => setPlayerCardTarget(data);
    game.events.on("player:cardOpen", handler);
    return () => { game.events.off("player:cardOpen", handler); };
  }, [game]);

  const handleDialogClose = useCallback(() => {
    setActiveNPC(null);
    game?.events.emit("npc:close");
  }, [game]);

  const handleAction = useCallback((action: NPCAction, npc?: NPCDefinition) => {
    setActiveNPC(null);
    // Daily quest hooks — triggered when player initiates the action
    if (walletAddress) {
      if (action.type === "swap")     incrementQuest(walletAddress, "swap_jupiter");
      if (action.type === "transfer") incrementQuest(walletAddress, "send_steve");
    }
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
    setWalletAddress(wallet);
    if (!game) {
      // Game still loading — store and replay once it's ready
      pendingWalletRef.current = wallet;
      return;
    }
    if (wallet) {
      game.events.emit("wallet:connected", wallet);
    } else {
      game.events.emit("wallet:disconnected");
    }
  }, [game]);

  // Replay a wallet connection that arrived before the game was ready
  useEffect(() => {
    if (!game || pendingWalletRef.current === undefined) return;
    const wallet = pendingWalletRef.current;
    pendingWalletRef.current = undefined;
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
        <ConnectScreen />
        <main className="w-screen h-screen relative">
          <PhaserGame onGameReady={setGame} />

          {/* Score HUD — top left */}
          <HUD />

          {/* Left-side panel stack — hunt card + daily quests */}
          {!isTouch ? (
            <div style={{
              position: "fixed", zIndex: 20,
              top: "max(env(safe-area-inset-top, 0px), 12px)",
              left: "max(env(safe-area-inset-left, 0px), 12px)",
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <WhereIsNPCCard gameRef={game} wallet={walletAddress} />
              <QuestPanel wallet={walletAddress} />
            </div>
          ) : (
            /* Mobile: icon buttons to open panels as overlays */
            <>
              <div style={{
                position: "fixed", zIndex: 20,
                top: "max(env(safe-area-inset-top, 0px), 52px)",
                left: "max(env(safe-area-inset-left, 0px), 12px)",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                <MobilePanelToggle icon="🎯" active={mobilePanel === "hunt"} onClick={() => setMobilePanel(v => v === "hunt" ? null : "hunt")} />
                <MobilePanelToggle icon="📋" active={mobilePanel === "quests"} onClick={() => setMobilePanel(v => v === "quests" ? null : "quests")} />
              </div>
              {mobilePanel !== null && (
                <div style={{
                  position: "fixed", zIndex: 25,
                  top: "max(env(safe-area-inset-top, 0px), 12px)",
                  left: "max(env(safe-area-inset-left, 0px), 58px)",
                  maxHeight: "60vh", overflowY: "auto",
                }} onClick={e => { if (e.target === e.currentTarget) setMobilePanel(null); }}>
                  {mobilePanel === "hunt" && <WhereIsNPCCard gameRef={game} wallet={walletAddress} />}
                  {mobilePanel === "quests" && <QuestPanel wallet={walletAddress} />}
                </div>
              )}
            </>
          )}

          {/* Top-right HUD panel */}
          <div
            className="fixed z-20"
            style={{
              top: "max(env(safe-area-inset-top, 0px), 12px)",
              right: "max(env(safe-area-inset-right, 0px), 12px)",
            }}
          >
            {isTouch ? (
              /* ── Mobile: compact horizontal strip ── */
              <div className="flex items-center gap-2">
                <PfpButton gameRef={game} onClick={() => setProfileOpen(true)} />
                <WardrobeButton onClick={() => setWardrobeOpen(true)} />
                <WalletBar onWalletChange={handleWalletChange} />
              </div>
            ) : (
              /* ── Desktop: unified card panel ── */
              <div style={{
                background: "rgba(8,10,22,0.58)",
                border: "1px solid rgba(153,69,255,0.2)",
                borderRadius: 14,
                overflow: "hidden",
                width: 210,
                backdropFilter: "blur(16px)",
                boxShadow: "0 4px 28px rgba(0,0,0,0.4)",
              }}>
                {/* Header: icon + PFP + wardrobe */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "11px 13px",
                  borderBottom: "1px solid rgba(153,69,255,0.1)",
                }}>
                  <img
                    src="/assets/branding/icon.png"
                    alt=""
                    style={{ width: 26, height: 26, imageRendering: "pixelated", opacity: 0.9 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div style={{ flex: 1 }} />
                  <WardrobeButton onClick={() => setWardrobeOpen(true)} />
                  <PfpButton gameRef={game} onClick={() => setProfileOpen(true)} />
                </div>

                {/* Wallet inline */}
                <div style={{ padding: "10px 13px" }}>
                  <WalletBar layout="panel" onWalletChange={handleWalletChange} />
                </div>

                {/* Footer: tx log + zoom */}
                <div style={{
                  display: "flex", alignItems: "center",
                  borderTop: "1px solid rgba(153,69,255,0.1)",
                  padding: "6px 10px",
                  gap: 6,
                }}>
                  <div style={{ flex: 1 }}>
                    <TransactionLogPanel
                      isOpen={logOpen}
                      onToggle={() => setLogOpen((v) => !v)}
                    />
                  </div>
                  <ZoomControl />
                </div>
              </div>
            )}
          </div>

          <ToastStack />
          {playerCardTarget && (
            <PlayerCard
              gameRef={game}
              wallet={playerCardTarget.wallet}
              displayName={playerCardTarget.displayName}
              myWallet={walletAddress}
              onClose={() => setPlayerCardTarget(null)}
            />
          )}
          <MobileControls gameRef={game} chatOpen={chatOpen} onChatToggle={() => setChatOpen((v) => !v)} />
          <ChatPanel gameRef={game} visible={chatOpen} />
          <NPCDialog npc={activeNPC} onClose={handleDialogClose} onAction={handleAction} />
          <ActionPanel action={activeAction} onClose={handleActionClose} />
          <ProfilePanel gameRef={game} isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
          {wardrobeOpen && (
            <WardrobePanel gameRef={game} onClose={() => setWardrobeOpen(false)} />
          )}
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

function MobilePanelToggle({ icon, active, onClick }: { icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 40, height: 40, borderRadius: 10,
        border: `1px solid ${active ? "rgba(20,241,149,0.6)" : "rgba(153,69,255,0.3)"}`,
        background: active ? "rgba(20,241,149,0.15)" : "rgba(8,10,22,0.7)",
        backdropFilter: "blur(8px)",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {icon}
    </button>
  );
}

function WardrobeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Wardrobe"
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        border: "1px solid rgba(20,241,149,0.35)",
        background: "rgba(20,241,149,0.07)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        transition: "background 0.15s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(20,241,149,0.18)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(20,241,149,0.07)")}
    >
      👕
    </button>
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
        width: 40,
        height: 40,
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
