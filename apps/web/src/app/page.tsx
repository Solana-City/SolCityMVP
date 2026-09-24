"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import dynamic from "next/dynamic";
import type { NPCDefinition, NPCAction } from "@/game/config/npcRegistry";
import type { GameWithSceneReady, SolCityWalletHost } from "@/game/scenes/CityScene";
import type { MiniGameContext, MiniGameResult } from "@/game/minigames/types";
import { PublicKey } from "@solana/web3.js";
import { launch as launchMiniGame } from "@/game/minigames";
import { usePinchZoom } from "@/ui/usePinchZoom";
import { hydrateQuests, incrementQuest } from "@/game/quests/QuestManager";
import { guideSeen, markGuideSeen } from "@/ui/CityGuide";
import { fetchStatus } from "@/game/names/nameService";
import { profileManager } from "@/game/config/profileManager";
import { useFlags } from "@/ui/useFlags";
import { setTrackedWallet, track } from "@/game/telemetry/track";
import { startSession } from "@/game/telemetry/session";

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
const OfflineBadge        = dynamic(() => import("@/ui/OfflineBadge"),        { ssr: false });
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
const PlayerCard          = dynamic(() => import("@/ui/PlayerCard"),          { ssr: false });
const AudioBridge         = dynamic(() => import("@/ui/AudioBridge"),         { ssr: false });
const NicknameModal       = dynamic(() => import("@/ui/NicknameModal"),       { ssr: false });
const DuelInvite          = dynamic(() => import("@/ui/DuelInvite"),          { ssr: false });
const CalendarPanel       = dynamic(() => import("@/ui/CalendarPanel"),       { ssr: false });

/** Sol Mechs duel invites: sent from a player card, answered from the city. */
const DUEL_INVITE_EVENT = "solcity:solmechs-duel";
const ExpressionWheel     = dynamic(() => import("@/ui/ExpressionWheel"),     { ssr: false });
const Minimap             = dynamic(() => import("@/ui/Minimap"),             { ssr: false });

import ErrorBoundary from "@/ui/ErrorBoundary";
import { chamferBox, avatarFrame, avatarPhoto } from "@/ui/chamfer";
import { OPEN_DM_EVENT } from "@/game/chat/dmEvents";
import { OPEN_CALENDAR_EVENT } from "@/game/daily/calendarEvents";
import { DM_UNREAD_EVENT, SEND_TOKENS_EVENT } from "@/game/chat/dmEvents";

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
  const miniGameOpenedAt = useRef(0);
  const [playerCardTarget, setPlayerCardTarget] = useState<{ wallet: string; displayName?: string } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const displayName = useDisplayName();
  const [mobilePanel, setMobilePanel] = useState<"hunt" | null>(null);
  /** Last wallet state actually handed to Phaser; undefined = nothing sent yet. */
  const lastSentWalletRef = useRef<string | null | undefined>(undefined);
  // Chat hidden by default on touch devices, visible on desktop
  const [chatOpen, setChatOpen] = useState(() =>
    typeof window === "undefined"
      ? true
      : !window.matchMedia("(pointer: coarse)").matches
  );

  usePinchZoom();

  // Content toggles from the developer panel: chat and nickname claiming can
  // be switched off without a deploy.
  const flags = useFlags();

  // ── Nicknames ────────────────────────────────────────────────────────────
  const [nickname, setNickname] = useState<{ forced: boolean; current: string | null } | null>(null);
  const nicknameOpenRef = useRef(false);
  const pendingGuideRef = useRef(false);
  const openNickname = useCallback((forced: boolean, current: string | null) => {
    nicknameOpenRef.current = true;
    setNickname({ forced, current });
    (globalThis as any).__solCityGameEvents?.emit("minimap:open", true); // pause game keys
  }, []);
  const closeNickname = useCallback((name: string | null) => {
    nicknameOpenRef.current = false;
    setNickname(null);
    (globalThis as any).__solCityGameEvents?.emit("minimap:open", false);
    if (name) profileManager.setDisplayName(name);
    if (pendingGuideRef.current) {
      pendingGuideRef.current = false;
      setActiveAction({ type: "tutor", label: "Start the tour" });
    }
  }, []);

  // First visit: once the player is in the city (past the connect screen)
  // and the scene is up, Sol's city guide opens by itself. Marked seen right
  // away so closing it early never makes it pop again; Sol replays it.
  useEffect(() => {
    const onEnter = () => {
      if (guideSeen()) return;
      markGuideSeen();
      window.setTimeout(() => {
        // A first-time wallet picks a nickname first; the tour waits for it.
        if (nicknameOpenRef.current) pendingGuideRef.current = true;
        else setActiveAction({ type: "tutor", label: "Start the tour" });
      }, 900);
    };
    window.addEventListener("solcity:entered-city", onEnter);
    return () => window.removeEventListener("solcity:entered-city", onEnter);
  }, []);

  // Long-pressing an image or the canvas on a phone opens the browser's
  // "save image / open in new tab" sheet, which interrupts play mid-gesture.
  // Suppress the context menu everywhere except text fields (paste still works).
  useEffect(() => {
    const block = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    document.addEventListener("dragstart", block);
    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("dragstart", block);
    };
  }, []);

  // Mobile panels and chat are mutually exclusive — the screen is too small
  // to stack overlays on top of the game view.
  const toggleMobilePanel = useCallback((panel: "hunt") => {
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
    const handler = (data: { id: string; context: MiniGameContext }) => {
      miniGameOpenedAt.current = Date.now();
      setActiveMiniGame(data);
    };
    game.events.on("minigame:launch", handler);
    return () => { game.events.off("minigame:launch", handler); };
  }, [game]);

  useEffect(() => {
    if (!game) return;
    const handler = (data: { wallet: string; displayName?: string }) => setPlayerCardTarget(data);
    game.events.on("player:cardOpen", handler);
    return () => { game.events.off("player:cardOpen", handler); };
  }, [game]);

  // "Send tokens" on a player's card: the same transfer panel Steve opens,
  // with that player already filled in as the recipient.
  useEffect(() => {
    const onSend = (e: Event) => {
      const { wallet, name } = (e as CustomEvent<{ wallet: string; name?: string }>).detail ?? {};
      if (!wallet) return;
      setActiveAction({ type: "transfer", label: "Send tokens", recipient: wallet, recipientName: name });
    };
    window.addEventListener(SEND_TOKENS_EVENT, onSend);
    return () => window.removeEventListener(SEND_TOKENS_EVENT, onSend);
  }, []);

  // Unread direct messages, for the dot on the chat button.
  const [unreadDms, setUnreadDms] = useState(0);
  useEffect(() => {
    const onUnread = (e: Event) => setUnreadDms((e as CustomEvent<{ count: number }>).detail?.count ?? 0);
    window.addEventListener(DM_UNREAD_EVENT, onUnread);
    return () => window.removeEventListener(DM_UNREAD_EVENT, onUnread);
  }, []);

  // "Message" on a player card: on mobile the chat is a toggled panel, so open it.
  useEffect(() => {
    const open = () => setChatOpen(true);
    window.addEventListener(OPEN_DM_EVENT, open);
    return () => window.removeEventListener(OPEN_DM_EVENT, open);
  }, []);

  const handleDialogClose = useCallback(() => {
    setActiveNPC(null);
    game?.events.emit("npc:close");
  }, [game]);

  const handleAction = useCallback((action: NPCAction, npc?: NPCDefinition) => {
    setActiveNPC(null);
    // Which protocol a player OPENS, against which one they finish (tracked
    // from the confirmed transaction below): the pair is the funnel each
    // partner project asks about.
    if (action.type !== "placeholder") {
      track("protocol-open", npc?.id ?? action.type, { label: npc?.name ?? action.type });
    }
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
        // No wagering: the food cart gets only its round deadline.
        launchMiniGame(action.miniGameId, {
          wallet: null,
          orderType: "sushi",
          expiresAt: Math.floor(Date.now() / 1000) + 60,
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
    // How long the game held them, which is the question a "plays" count
    // cannot answer on its own.
    if (activeMiniGame?.id && miniGameOpenedAt.current) {
      const seconds = Math.round((Date.now() - miniGameOpenedAt.current) / 1000);
      miniGameOpenedAt.current = 0;
      if (seconds > 2) track("minigame", `${activeMiniGame.id}-time`, { value: seconds, label: `${seconds}s played` });
    }
    setActiveMiniGame(null);
    game?.events.emit("minigame:close");
  }, [game, activeMiniGame?.id]);

  // Records result to the ephemeral rollup (session key, no popup), then closes.
  const handleMiniGameResult = useCallback(async (result: MiniGameResult) => {
    // The id rides along so the scene can tell WHICH game was won — the
    // Superteam Brasil cap is a Kite Clash reward, not a reward for any win.
    game?.events.emit("minigame:result", { id: activeMiniGame?.id, success: result.success });
    if (activeMiniGame?.id) {
      const meta = result.metadata ?? {};
      const score = typeof meta.score === "number"
        ? meta.score
        : typeof meta.completedOrders === "number" ? meta.completedOrders : 0;
      track("minigame", activeMiniGame.id, {
        value: score,
        success: result.success,
        label: `${result.success ? "won" : "lost"}${score ? ` · ${score}` : ""}`,
      });
    }
    // Games with their own result screen (Sol Mechs) report the outcome as
    // soon as a match ends and stay open; the player leaves when ready.
    if (result.metadata?.keepOpen) return;
    handleMiniGameClose();
  }, [game, activeMiniGame, handleMiniGameClose]);

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
    setTrackedWallet(wallet);
    // Quest progress follows the player across devices.
    if (wallet) void hydrateQuests(wallet);
    setWalletAddress(wallet);
    // Mirror it somewhere CityScene can read on its own. If the wallet connects
    // while BootScene is still preloading there is no scene to push to yet, and
    // the push below can only fire once; CityScene reads this at startup so a
    // wallet that arrived early is never stranded.
    (globalThis as SolCityWalletHost).__solCityWallet = wallet;
  }, []);

  // A wallet without a nickname is asked once, on its first login. The player
  // can skip; the Profile's CHANGE NICKNAME sets one later. An existing name
  // syncs into the profile.
  useEffect(() => {
    if (!walletAddress) { if (nicknameOpenRef.current) closeNickname(null); return; }
    let cancelled = false;
    fetchStatus(walletAddress).then((st) => {
      if (cancelled) return;
      if (st.name) { profileManager.setDisplayName(st.name); return; }
      if (!st.enabled || st.locked || !flags.nicknames) return;
      const askedKey = `solcity:nickname-asked:${walletAddress}`;
      try {
        if (localStorage.getItem(askedKey)) return;
        localStorage.setItem(askedKey, "1");
      } catch { /* storage blocked: ask this session */ }
      openNickname(false, null);
    });
    return () => { cancelled = true; };
  }, [walletAddress, openNickname, closeNickname, flags.nicknames]);

  // A duel invite (sent from a player card, or accepted from the invite card)
  // opens Sol Mechs straight into that duel.
  useEffect(() => {
    const onDuel = (e: Event) => {
      const duel = (e as CustomEvent).detail as { kind: "challenge" | "accept"; opponent: string; name?: string };
      if (!duel?.opponent || !walletAddress) return;
      let wallet: PublicKey | null = null;
      try { wallet = new PublicKey(walletAddress); } catch { return; }
      setActiveMiniGame({ id: "sol-mechs", context: { wallet, duel } });
    };
    window.addEventListener(DUEL_INVITE_EVENT, onDuel);
    return () => window.removeEventListener(DUEL_INVITE_EVENT, onDuel);
  }, [walletAddress]);

  // The Profile's "change nickname" button.
  useEffect(() => {
    const onOpen = () => {
      if (!walletAddress) return;
      if (!flags.nicknames) return;
      fetchStatus(walletAddress).then((st) => openNickname(false, st.name));
    };
    window.addEventListener("solcity:open-nickname", onOpen);
    return () => window.removeEventListener("solcity:open-nickname", onOpen);
  }, [walletAddress, openNickname, flags.nicknames]);

  // CityScene only starts listening for "wallet:connected" at the end of its
  // create(). `game` goes non-null the instant `new Phaser.Game()` returns —
  // long before BootScene has preloaded — so waiting on `game` alone emitted
  // into an emitter with no subscribers and Phaser dropped it silently. That
  // left the player connected in React but never logged into the game or the
  // multiplayer session until they disconnected and connected again.
  //
  // Counter, not a boolean, so a scene restart re-runs the sync below.
  const [sceneReadyTick, setSceneReadyTick] = useState(0);
  useEffect(() => {
    if (!game) return;
    const onReady = () => {
      // A fresh scene knows nothing — resend whatever we have.
      lastSentWalletRef.current = undefined;
      setSceneReadyTick((t) => t + 1);
    };
    game.events.on("scene:ready", onReady);
    if ((game as GameWithSceneReady).__solCitySceneReady) onReady();
    return () => { game.events.off("scene:ready", onReady); };
  }, [game]);

  // The single place that tells Phaser about the wallet. Runs once the scene is
  // listening, and dedupes so a re-render never opens a second session.
  useEffect(() => {
    if (!game || sceneReadyTick === 0) return;
    if (lastSentWalletRef.current === walletAddress) return;
    const firstSync = lastSentWalletRef.current === undefined;
    lastSentWalletRef.current = walletAddress;
    if (walletAddress) {
      game.events.emit("wallet:connected", walletAddress);
    } else if (!firstSync) {
      game.events.emit("wallet:disconnected");
    }
  }, [game, sceneReadyTick, walletAddress]);

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
        <ConnectScreen />
        <main className="w-screen app-viewport relative">
          <PhaserGame onGameReady={(g) => { setGame(g); startSession(); }} />

          {/* Left-side panel stack — hunt card + daily quests */}
          {!isTouch ? (
            <div style={{
              position: "fixed", zIndex: 20,
              top: "max(env(safe-area-inset-top, 0px), 12px)",
              left: "max(env(safe-area-inset-left, 0px), 12px)",
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <WhereIsNPCCard gameRef={game} wallet={walletAddress} />
            </div>
          ) : (
            /* Mobile: single icon rail — hunt and chat toggles.
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
                <MobilePanelToggle iconSrc="/assets/ui/ico_chat.png" label="Chat" active={chatOpen} onClick={toggleMobileChat} dot={unreadDms > 0} />
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
            {/* One 9-slice framed card: profile row, wallet row, onchain+zoom
                row — each row nested in its own thinner frame inside the
                bold outer one. */}
            <div style={{
              width: isTouch ? 190 : 300,
              borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
              borderImage: OUTER_FRAME,
              imageRendering: "pixelated",
              display: "flex", flexDirection: "column", gap: isTouch ? 6 : 8,
            }}>
              {/* Profile */}
              <Framed width={9}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 4 }}>
                  <span style={{ display: "block", flexShrink: 0 }}>
                    <PfpButton gameRef={game} size={isTouch ? 40 : 52} onClick={() => setProfileOpen(true)} />
                  </span>
                  <span style={{
                    flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontFamily: '"Press Start 2P", monospace', fontSize: isTouch ? 8 : 11, color: "#F3F7FC",
                  }}>{displayName}</span>
                  <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <WardrobeButton size={isTouch ? 30 : 34} onClick={() => setWardrobeOpen(true)} />
                    <CalendarButton size={isTouch ? 30 : 34} />
                    <HudIconBtn
                      size={isTouch ? 30 : 34} src="/assets/ui/icon_map.png"
                      onClick={() => setMapOpen((v) => !v)}
                      title="Minimap" aria-expanded={mapOpen} aria-controls="hud-map-preview"
                      aria-label={mapOpen ? "Hide minimap" : "Show minimap"}
                    />
                  </span>
                </div>
              </Framed>

              {/* Minimap preview — the small square map, shown on demand;
                  its own floating ⤢ button opens the full map. */}
              {mapOpen && (
                <div id="hud-map-preview" style={{ display: "flex", justifyContent: "center" }}>
                  <Minimap bare compact={isTouch ? "mobile" : "desktop"} />
                </div>
              )}

              {/* Wallet */}
              <Framed width={9}>
                <div style={{ padding: "4px 8px" }}>
                  <WalletBar layout="panel" onWalletChange={handleWalletChange} />
                </div>
              </Framed>

              {/* Onchain + zoom — no per-button frame, just the row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: isTouch ? 4 : 6, padding: "0 2px" }}>
                <TransactionLogPanel
                  isOpen={logOpen}
                  onToggle={() => setLogOpen((v) => !v)}
                  gameRef={game}
                  compact={isTouch}
                />
                <ZoomControl compact={isTouch} />
              </div>
            </div>

          </div>

          <DuelInvite wallet={walletAddress} />
          <OfflineBadge />
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
          {flags.chat && <ChatPanel gameRef={game} visible={chatOpen} />}
          <CalendarPanel gameRef={game} />
          <NPCDialog npc={activeNPC} onClose={handleDialogClose} onAction={handleAction} />
          {nickname && walletAddress && (
            <NicknameModal wallet={walletAddress} current={nickname.current} forced={nickname.forced} onDone={closeNickname} />
          )}
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

function MobilePanelToggle({ iconSrc, label, active, onClick, dot }: {
  iconSrc: string; label: string; active: boolean; onClick: () => void;
  /** A direct message is waiting and the panel is closed. */
  dot?: boolean;
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
          boxShadow: "0 0 0 2px rgba(183,233,40,0.75)",
          pointerEvents: "none",
        }} />
      )}
      {dot && (
        <span style={{
          position: "absolute", top: 2, right: 2, width: 9, height: 9, borderRadius: "50%",
          background: "#FFD700", boxShadow: "0 0 6px rgba(255,215,0,0.9)",
          pointerEvents: "none",
        }} />
      )}
    </button>
  );
}

/** Rail button (below Chat) that opens the expression wheel on touch.
    Same chrome as MobilePanelToggle with the pixel-art ico_emoji; the wheel
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
      <img
        src="/assets/ui/ico_emoji.png"
        width={24} height={24} alt="Expressions" draggable={false}
        style={{ imageRendering: "pixelated", position: "relative" }}
      />
    </button>
  );
}

/** The pixel-frame 9-slice used for the whole HUD card's outer border. */
const OUTER_FRAME = 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round';
/** The thinner ring used to nest each row inside the outer frame. */
const innerFrame = (width: number) => `url(/assets/branding/ui/frame-map-test.png) 18 fill / ${width}px / 0 round`;

/** One row of the HUD card, framed with the thinner nested ring. */
function Framed({ width = 9, style, children }: { width?: number; style?: CSSProperties; children: ReactNode }) {
  return (
    <div style={{
      borderWidth: width, borderStyle: "solid", borderColor: "transparent",
      borderImage: innerFrame(width),
      imageRendering: "pixelated",
      ...style,
    }}>
      {children}
    </div>
  );
}

/** The player's own display name, kept in sync with the profile singleton. */
function useDisplayName(): string {
  const [name, setName] = useState("Citizen");
  useEffect(() => {
    setName(profileManager.get().displayName);
    profileManager.onChange((p) => setName(p.displayName));
  }, []);
  return name;
}

/**
 * Opens the city calendar. Drawn as a tiny page-a-day calendar showing
 * today's date, with a dot until the calendar has been opened today.
 */
function CalendarButton({ size = 30 }: { size?: number }) {
  const [day, setDay] = useState<number | null>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const read = () => {
      const today = new Date().toISOString().slice(0, 10);
      setDay(new Date().getUTCDate());
      try { setFresh(localStorage.getItem("solcity:calendar-seen") !== today); } catch { setFresh(false); }
    };
    read();
    const id = setInterval(read, 30_000);
    window.addEventListener(OPEN_CALENDAR_EVENT, read);
    return () => { clearInterval(id); window.removeEventListener(OPEN_CALENDAR_EVENT, read); };
  }, []);
  return (
    <HudIconBtn
      size={size} src="/assets/ui/icon_calendar.png" title="City calendar" aria-label="City calendar"
      onClick={() => { window.dispatchEvent(new Event(OPEN_CALENDAR_EVENT)); setFresh(false); }}
      overlay={<span style={{
        position: "absolute", left: 0, right: 0, top: "40%", height: "44%",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: '"Press Start 2P", monospace', fontSize: Math.max(6, Math.round(size * 0.24)),
        color: "#0a1a2e", lineHeight: 1, pointerEvents: "none",
      }}>{day ?? ""}</span>}
      dot={fresh}
    />
  );
}

function WardrobeButton({ onClick, size = 36 }: { onClick: () => void; size?: number }) {
  return <HudIconBtn size={size} src="/assets/ui/icon_wardrob.png" title="Wardrobe" onClick={onClick} />;
}

/** One HUD-rail icon button: the sprite carries its own frame; hover brightens and lifts it. */
function HudIconBtn({ size, src, onClick, title, overlay, dot, ...aria }: {
  size: number; src: string; onClick: () => void; title: string;
  overlay?: ReactNode; dot?: boolean;
  "aria-label"?: string; "aria-expanded"?: boolean; "aria-controls"?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick} title={title} {...aria}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", width: size, height: size, padding: 0, border: "none", background: "none",
        cursor: "pointer", flexShrink: 0, display: "block",
        filter: hover ? "brightness(1.25) drop-shadow(0 0 4px rgba(20,240,198,0.7))" : "none",
        transform: hover ? "translateY(-1px)" : "none",
        transition: "filter 0.12s, transform 0.12s",
      }}
    >
      <img src={src} alt="" draggable={false}
        style={{ width: "100%", height: "100%", imageRendering: "pixelated", display: "block" }} />
      {overlay}
      {dot && (
        <span style={{
          position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: "50%",
          background: "#FFD700", boxShadow: "0 0 6px #FFD700",
        }} />
      )}
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
      className="cursor-pointer transition-transform hover:scale-105"
      style={{
        ...avatarFrame(1, size),
        ...avatarPhoto(pfp),
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      title="Profile [P]"
    >
      {!pfp && (
        <span style={{ color: "#B7E928", fontSize: size >= 48 ? "16px" : "13px", fontWeight: "bold" }}>{initial}</span>
)}
    </button>
  );
}
