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
const WalletSignBridge    = dynamic(() => import("@/ui/WalletSignBridge"),    { ssr: false });
const MobileControls      = dynamic(() => import("@/ui/MobileControls"),      { ssr: false });
const ZoomControl         = dynamic(() => import("@/ui/ZoomControl"),         { ssr: false });
const MiniGameOverlay     = dynamic(() => import("@/ui/MiniGameOverlay"),     { ssr: false });
const MwaRegistration     = dynamic(() => import("@/ui/MwaRegistration"),     { ssr: false });
const RotatePrompt        = dynamic(() => import("@/ui/RotatePrompt"),        { ssr: false });
const WardrobePanel       = dynamic(() => import("@/ui/WardrobePanel"),       { ssr: false });
const ConnectScreen       = dynamic(() => import("@/ui/ConnectScreen"),       { ssr: false });
const SWUpdater           = dynamic(() => import("@/ui/SWUpdater"),            { ssr: false });
const WhereIsNPCCard      = dynamic(() => import("@/ui/WhereIsNPCCard"),      { ssr: false });
const QuestPanel          = dynamic(() => import("@/ui/QuestPanel"),          { ssr: false });
const PlayerCard          = dynamic(() => import("@/ui/PlayerCard"),          { ssr: false });
const AudioBridge         = dynamic(() => import("@/ui/AudioBridge"),         { ssr: false });
const ExpressionWheel     = dynamic(() => import("@/ui/ExpressionWheel"),     { ssr: false });

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
  // Login-gate phase: "connecting" holds the ConnectScreen up (with a spinner)
  // from wallet-connect until the on-chain session is established, so the player
  // never enters the world before delegation confirms.
  const [sessionPhase, setSessionPhase] = useState<"idle" | "connecting" | "ready">("idle");
  // Set when connect() fails/times out — the gate shows an error + RETRY
  // instead of entering the world in a non-on-chain state.
  const [sessionError, setSessionError] = useState(false);
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

  // Mobile panels and chat are mutually exclusive — the screen is too small
  // to stack overlays on top of the game view.
  const toggleMobilePanel = useCallback((panel: "hunt" | "quests") => {
    setChatOpen(false);
    setMobilePanel(v => (v === panel ? null : panel));
  }, []);
  const toggleMobileChat = useCallback(() => {
    setMobilePanel(null);
    setChatOpen(v => !v);
  }, []);

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

  // Session lifecycle from CityScene drives the login gate.
  useEffect(() => {
    if (!game) return;
    const onConnecting = () => { setSessionError(false); setSessionPhase("connecting"); };
    const onReady = () => { setSessionError(false); setSessionPhase("ready"); };
    const onError = () => setSessionError(true);
    game.events.on("game:sessionConnecting", onConnecting);
    game.events.on("game:sessionReady", onReady);
    game.events.on("game:sessionError", onError);
    return () => {
      game.events.off("game:sessionConnecting", onConnecting);
      game.events.off("game:sessionReady", onReady);
      game.events.off("game:sessionError", onError);
    };
  }, [game]);


  const handleWalletChange = useCallback((wallet: string | null) => {
    setWalletAddress(wallet);
    // Reset the gate when the wallet drops so a fresh connect re-arms it.
    if (!wallet) { setSessionPhase("idle"); setSessionError(false); }
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
      {/* Seamless SW updates so a stale/broken cached build self-recovers. */}
      <SWUpdater />
      <SolanaProvider>
        {/* Blocks the game canvas while the device is in portrait — Seeker/mobile */}
        <RotatePrompt />
        {/* Registers Mobile Wallet Adapter on Android/Seeker — no-op elsewhere */}
        <MwaRegistration />
        {/* Headless bridge so Phaser can request wallet signatures */}
        <WalletSignBridge />
        <ConnectScreen sessionPhase={sessionPhase} sessionError={sessionError} />
        <main className="w-screen app-viewport relative">
          <PhaserGame onGameReady={setGame} />

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
            /* Mobile: single icon rail — hunt, quests and chat toggles.
               Panels open as overlays and are mutually exclusive with the
               chat so the small screen never stacks multiple windows. */
            <>
              <div style={{
                position: "fixed", zIndex: 20,
                top: "max(env(safe-area-inset-top, 0px), 12px)",
                left: "max(env(safe-area-inset-left, 0px), 12px)",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                <MobilePanelToggle iconSrc="/assets/ui/ico_achievements.png" label="Find someone" active={mobilePanel === "hunt"} onClick={() => toggleMobilePanel("hunt")} />
                <MobilePanelToggle iconSrc="/assets/ui/ico_tasks.png" label="Daily quests" active={mobilePanel === "quests"} onClick={() => toggleMobilePanel("quests")} />
                <MobilePanelToggle iconSrc="/assets/ui/ico_chat.png" label="Chat" active={chatOpen} onClick={toggleMobileChat} />
                <ExpressionToggle />
              </div>
              {mobilePanel !== null && (
                /* Full-screen transparent backdrop — tap anywhere outside the panel to close */
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 25 }}
                  onClick={() => setMobilePanel(null)}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "max(env(safe-area-inset-top, 0px), 12px)",
                      // To the right of the icon rail (rail left + 36px width
                      // + gap), including on notched phones where the rail
                      // itself is pushed in by the safe-area inset.
                      left: "calc(max(env(safe-area-inset-left, 0px), 12px) + 46px)",
                      maxHeight: "calc(100dvh - 24px)", overflowY: "auto",
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {mobilePanel === "hunt" && <WhereIsNPCCard gameRef={game} wallet={walletAddress} />}
                    {mobilePanel === "quests" && <QuestPanel wallet={walletAddress} />}
                  </div>
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
              /* ── Mobile: compact horizontal strip + zoom below ── */
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-1.5">
                  <PfpButton gameRef={game} size={32} onClick={() => setProfileOpen(true)} />
                  <WardrobeButton size={32} onClick={() => setWardrobeOpen(true)} />
                  <WalletBar onWalletChange={handleWalletChange} />
                </div>
                <ZoomControl />
              </div>
            ) : (
              /* ── Desktop: unified card panel ── */
              <div style={{
                background: "rgba(8,10,22,0.58)",
                border: "1px solid rgba(153,69,255,0.2)",
                borderRadius: 14,
                overflow: "hidden",
                width: 250,
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

                {/* Footer: tx log + zoom, side by side. The ONCHAIN badge is
                    allowed to shrink/ellipsis (minWidth:0) so ZoomControl
                    (flexShrink:0) always keeps its full size and never gets
                    pushed past the card's edge. */}
                <div style={{
                  display: "flex", alignItems: "center",
                  borderTop: "1px solid rgba(153,69,255,0.1)",
                  padding: "6px 10px",
                  gap: 6,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TransactionLogPanel
                      isOpen={logOpen}
                      onToggle={() => setLogOpen((v) => !v)}
                      gameRef={game}
                    />
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <ZoomControl />
                  </div>
                </div>
              </div>
            )}
          </div>

          <ToastStack />
          <AudioBridge game={game} />
          {playerCardTarget && (
            <PlayerCard
              gameRef={game}
              wallet={playerCardTarget.wallet}
              displayName={playerCardTarget.displayName}
              myWallet={walletAddress}
              onClose={() => setPlayerCardTarget(null)}
            />
          )}
          <MobileControls />
          <ExpressionWheel gameRef={game} />
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

function MobilePanelToggle({ iconSrc, label, active, onClick }: {
  iconSrc: string; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        position: "relative",
        width: 36, height: 36, padding: 0,
        background: "transparent", border: "none",
        cursor: "pointer", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        WebkitTapHighlightColor: "transparent",
        filter: active ? "brightness(1.45)" : "none",
      }}
    >
      <img
        src="/assets/ui/bg_ico.png"
        width={36} height={36} alt="" draggable={false}
        style={{ imageRendering: "pixelated", position: "absolute", inset: 0 }}
      />
      <img
        src={iconSrc}
        width={24} height={24} alt={label} draggable={false}
        style={{ imageRendering: "pixelated", position: "relative" }}
      />
      {active && (
        <span style={{
          position: "absolute", inset: 1, borderRadius: 7,
          boxShadow: "0 0 0 2px rgba(20,241,149,0.75)",
          pointerEvents: "none",
        }} />
      )}
    </button>
  );
}

/** Rail button (below Chat) that opens the expression wheel on touch.
    Matches the MobilePanelToggle chrome but shows the 😀 glyph — the wheel
    isn't a panel, so it just fires the open event. */
function ExpressionToggle() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("solcity:openExpressionWheel"))}
      title="Expressions"
      style={{
        position: "relative",
        width: 36, height: 36, padding: 0,
        background: "transparent", border: "none",
        cursor: "pointer", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <img
        src="/assets/ui/bg_ico.png"
        width={36} height={36} alt="" draggable={false}
        style={{ imageRendering: "pixelated", position: "absolute", inset: 0 }}
      />
      <span style={{ position: "relative", fontSize: 20, lineHeight: 1 }}>😀</span>
    </button>
  );
}

function WardrobeButton({ onClick, size = 36 }: { onClick: () => void; size?: number }) {
  return (
    <button
      onClick={onClick}
      title="Wardrobe"
      style={{
        width: size,
        height: size,
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
      <img
        src="/assets/ui/ico_wardrop.png"
        width={size >= 36 ? 24 : 20} height={size >= 36 ? 24 : 20}
        alt="Wardrobe" draggable={false}
        style={{ imageRendering: "pixelated" }}
      />
    </button>
  );
}

function PfpButton({ gameRef, onClick, size = 40 }: {
  gameRef: Phaser.Game | null; onClick: () => void; size?: number;
}) {
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
        width: size,
        height: size,
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
        <span style={{ color: "#9945FF", fontSize: size >= 40 ? "18px" : "14px", fontWeight: "bold" }}>{initial}</span>
      )}
    </button>
  );
}
