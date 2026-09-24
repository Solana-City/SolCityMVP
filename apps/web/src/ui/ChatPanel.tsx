"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatManager, ChatMessage, ChatChannel, DMChannel } from "@/game/chat/ChatManager";
import { getChannelColor, getChannelLabel, SELF_COLOR } from "@/game/chat/ChatManager";
import { EMOJI_REGISTRY } from "@/game/chat/EmojiSystem";
import ChatGuide from "./ChatGuide";
import { containsLink, maskLinks } from "@/game/chat/linkFilter";
import { DMClient, OPEN_DM_EVENT, resolveRecipient } from "@/game/chat/dmClient";
import { DM_UNREAD_EVENT } from "@/game/chat/dmEvents";
import { cachedName, requestNames } from "@/game/names/nameService";
import type { OnChainMultiplayer } from "@/game/multiplayer/OnChainMultiplayer";
import { useWallet } from "@solana/wallet-adapter-react";
import { chamferBox } from "@/ui/chamfer";

const DM_COLOR = "#FFD700";
const BTN_FRAME = 'url(/assets/branding/ui/frame-btn.png) 18 fill / 4px / 0 round';
const BTN_FRAME_FILL = 'url(/assets/branding/ui/frame-btn-fill.png) 18 fill / 4px / 0 round';

function short(wallet: string): string {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

interface ChatPanelProps {
  gameRef: Phaser.Game | null;
  visible?: boolean;
}

export default function ChatPanel({ gameRef, visible = true }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [activeChannel, setActiveChannel] = useState<ChatChannel>("city");
  /** A one-line problem shown above the input (link blocked, DMs off...). */
  const [notice, setNotice] = useState<string | null>(null);
  const [dmMode, setDmMode] = useState(false);
  /** Wallet of the open conversation; null shows the "who to" prompt. */
  const [dmPeer, setDmPeer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { publicKey } = useWallet();
  const myWallet = publicKey?.toBase58() ?? null;
  const dmRef = useRef<DMClient | null>(null);
  const [dmChannels, setDmChannels] = useState<DMChannel[]>([]);
  const [isTouch, setIsTouch] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  /**
   * How much of the viewport the on-screen keyboard is covering, and how much
   * height is left above it.
   *
   * visualViewport is measured rather than assumed, because the two cases look
   * different to CSS: when the window resizes for the keyboard the panel is
   * already clear of it and the inset reads 0, and when it does not resize the
   * panel sits behind the keyboard and must be lifted by hand. The Android app
   * and the mobile browser each behave one of those two ways.
   */
  const [keyboard, setKeyboard] = useState({ inset: 0, visible: 0 });
  /**
   * The input holding focus is the signal that the keyboard is up, and it is
   * the only one that works in both cases: when the window resizes for the
   * keyboard, the measured inset is 0 even though the space is now tiny, and
   * the panel still has to drop its 156px gap or it lands off the top.
   */
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Below ~120px it is a browser chrome change, not a keyboard.
      setKeyboard({ inset: covered > 120 ? covered : 0, visible: vv.height });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouch(mq.matches);
    if (mq.matches) setIsExpanded(false);
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [chatManager, setChatManager] = useState<ChatManager | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!gameRef) return;
    const check = setInterval(() => {
      const scene = gameRef.scene.getScene("CityScene");
      if (scene) {
        const cm = scene.registry.get("chatManager") as ChatManager | undefined;
        if (cm) {
          setChatManager(cm);
          setMessages(cm.getVisibleLog());
          setDmChannels(cm.getDMChannels());
          cm.onLogUpdate((log) => {
            setMessages([...log]);
            setDmChannels(cm.getDMChannels());
          });
          clearInterval(check);
        }
      }
    }, 200);
    return () => clearInterval(check);
  }, [gameRef]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  // Direct messages: one client per connected wallet, fed into ChatManager's
  // dm:<wallet> conversations. Needs the multiplayer session key to sign.
  useEffect(() => {
    if (!gameRef || !myWallet || !chatManager) return;
    let client: DMClient | null = null;
    let unsubscribe = () => {};
    const id = setInterval(() => {
      const net = gameRef.scene.getScene("CityScene")?.registry.get("network") as OnChainMultiplayer | undefined;
      if (!net) return;
      clearInterval(id);
      client = new DMClient(myWallet, () => net.getSessionKeys().getSessionKey());
      unsubscribe = client.onMessage((m) => {
        requestNames([m.from]);
        const name = cachedName(m.from) ?? short(m.from);
        const ch = chatManager.ensureDM(m.from, name);
        chatManager.addMessage(ch, m.from, name, maskLinks(m.text), DM_COLOR);
      });
      client.start();
      dmRef.current = client;
    }, 500);
    return () => {
      clearInterval(id);
      unsubscribe();
      client?.stop();
      dmRef.current = null;
    };
  }, [gameRef, myWallet, chatManager]);

  const openPeer = useCallback((wallet: string, name?: string) => {
    if (!chatManager) return;
    requestNames([wallet]);
    const ch = chatManager.openDM(wallet, name || cachedName(wallet) || short(wallet));
    setActiveChannel(ch);
    setDmMode(true);
    setDmPeer(wallet);
    setNotice(null);
  }, [chatManager]);

  const showDmPrompt = useCallback(() => {
    setDmMode(true);
    setDmPeer(null);
    setNotice(null);
    setActiveChannel("city");
    chatManager?.setActiveChannel("city");
  }, [chatManager]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !gameRef || busy) return;

    // DM tab with no conversation open: the input is the "to" field.
    if (dmMode && !dmPeer) {
      if (!myWallet) { setNotice("Connect a wallet to send direct messages."); return; }
      setBusy(true);
      const found = await resolveRecipient(text);
      setBusy(false);
      if ("error" in found) { setNotice(found.error); return; }
      if (found.wallet === myWallet) { setNotice("That's you."); return; }
      setInput("");
      openPeer(found.wallet, found.wallet === text ? undefined : text.replace(/^@/, ""));
      return;
    }

    // Keep the text so the player can take the link out and resend.
    if (containsLink(text)) {
      setNotice("Links are not allowed in chat.");
      return;
    }

    if (dmMode && dmPeer) {
      const client = dmRef.current;
      if (!client || !myWallet) { setNotice("Connect a wallet to send direct messages."); return; }
      setBusy(true);
      const res = await client.send(dmPeer, text);
      setBusy(false);
      if (!res.ok) { setNotice(res.message); return; }
      const me = cachedName(myWallet) ?? short(myWallet);
      chatManager?.addMessage(`dm:${dmPeer}`, myWallet, me, text, SELF_COLOR);
      setInput("");
      return;
    }

    gameRef.events.emit("chat:send", text);
    setInput("");
    setShowEmojis(false);
  }, [input, gameRef, busy, dmMode, dmPeer, myWallet, openPeer, chatManager]);

  // Reading direct messages: check the inbox often while the tab is open,
  // and rarely otherwise (each check is a paid command).
  useEffect(() => { dmRef.current?.setActive(dmMode); }, [dmMode]);

  // The chat may be a closed panel on a phone, where the tab badge cannot be
  // seen: tell the HUD so its chat button can show a dot.
  const unreadTotal = dmChannels.reduce((n, dm) => n + dm.unread, 0);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(DM_UNREAD_EVENT, { detail: { count: unreadTotal } }));
  }, [unreadTotal]);

  // "Message" on a player card opens the conversation here.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { wallet, name } = (e as CustomEvent<{ wallet: string; name?: string }>).detail ?? {};
      if (!wallet) return;
      setIsExpanded(true);
      openPeer(wallet, name);
      setTimeout(() => inputRef.current?.focus(), 80);
    };
    window.addEventListener(OPEN_DM_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DM_EVENT, onOpen);
  }, [openPeer]);

  const handleFocus = useCallback(() => {
    setTyping(true);
    gameRef?.events.emit("chat:focus", true);
    // On mobile, scroll the input into view after the virtual keyboard rises.
    // Small delay lets the keyboard animate before measuring layout.
    if (isTouch) {
      setTimeout(() => inputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 320);
    }
  }, [gameRef, isTouch]);

  const handleBlur = useCallback(() => {
    setTyping(false);
    gameRef?.events.emit("chat:focus", false);
  }, [gameRef]);

  const switchChannel = useCallback((ch: ChatChannel) => {
    setActiveChannel(ch);
    chatManager?.setActiveChannel(ch);
  }, [chatManager]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") void handleSend();
    if (e.key === "Escape") inputRef.current?.blur();
    e.stopPropagation();
  }, [handleSend]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // A click or tap anywhere outside the chat hands control back to the city.
  // Phaser cancels the pointerdown on its canvas, so the browser never blurs
  // the input by itself: players tried to walk and typed "wasd" into chat.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      if (document.activeElement === inputRef.current) inputRef.current?.blur();
      setShowGuide(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // On mobile the parent controls visibility; on desktop always show
  if (isTouch && !visible) return null;

  const channelColor = getChannelColor(activeChannel);
  const dmUnread = dmChannels.reduce((n, dm) => n + dm.unread, 0);
  const peerName = dmPeer ? (dmChannels.find((d) => d.sessionId === dmPeer)?.name ?? short(dmPeer)) : "";
  const placeholder = !dmMode
    ? "Say something..."
    : dmPeer ? `Message ${peerName}...` : "Nickname or wallet...";

  return (
    <div
      ref={rootRef}
      className="fixed z-20"
      style={{
        left: "max(env(safe-area-inset-left, 0px), 16px)",
        bottom: isTouch
          ? typing
            // Typing: sit just above the keys. The 156px gap exists to clear
            // the movement controls, which do not matter while typing.
            ? `${keyboard.inset + 8}px`
            : "calc(env(safe-area-inset-bottom, 0px) + 156px)"
          : "16px",
        width: isTouch ? "min(280px, calc(100vw - 180px))" : "360px",
        fontFamily: '"Press Start 2P", monospace',
        borderWidth: 20,
        borderStyle: "solid",
        borderColor: "transparent",
        borderImage: 'url(/assets/branding/ui/frame-chat.png) 64 fill / 20px / 0 round',
        imageRendering: "pixelated",
        padding: 6,
      }}
    >
      {showGuide && <ChatGuide touch={isTouch} onClose={() => setShowGuide(false)} />}
      {/* Channel tabs */}
      <div className="flex gap-0.5 mb-0.5 overflow-x-auto">
        <TabButton
          label={getChannelLabel("city", dmChannels)}
          color={getChannelColor("city")}
          active={!dmMode}
          onClick={() => { setDmMode(false); setNotice(null); switchChannel("city"); }}
        />
        <TabButton
          label="Direct Message"
          color={DM_COLOR}
          active={dmMode}
          badge={dmUnread > 0 ? dmUnread : undefined}
          onClick={() => {
            if (dmMode) return;
            const last = dmPeer && dmChannels.some((d) => d.sessionId === dmPeer) ? dmPeer : null;
            if (last) openPeer(last); else showDmPrompt();
          }}
        />
        <button
          onClick={() => setShowGuide((v) => !v)}
          aria-label="How the chat works"
          title="How the chat works"
          className="ml-auto self-center"
          style={{
            width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
            background: showGuide ? "rgba(183,233,40,0.18)" : "rgba(10,10,30,0.7)",
            color: showGuide ? "#B7E928" : "#9a9ab5",
            border: `1px solid ${showGuide ? "rgba(183,233,40,0.5)" : "rgba(153,69,255,0.35)"}`,
            fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: "bold", fontSize: 11,
            lineHeight: "16px", padding: 0, cursor: "pointer",
          }}
        >
          i
        </button>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="px-2 py-1 text-xs"
          style={{ background: "transparent", color: "#555566", border: "none", cursor: "pointer" }}
        >
          {isExpanded ? "\u25BC" : "\u25B2"}
        </button>
      </div>

      {/* Conversations */}
      {dmMode && isExpanded && (
        <div
          className="flex gap-1 p-1 overflow-x-auto"
          style={{ background: "rgba(10,10,30,0.92)", borderLeft: "1px solid rgba(153,69,255,0.2)", borderRight: "1px solid rgba(153,69,255,0.2)" }}
        >
          {dmChannels.map((dm) => (
            <Chip
              key={dm.sessionId}
              label={dm.name}
              active={dm.sessionId === dmPeer}
              unread={dm.unread}
              onClick={() => openPeer(dm.sessionId, dm.name)}
            />
          ))}
          <Chip label="+ NEW" active={!dmPeer} onClick={() => { showDmPrompt(); inputRef.current?.focus(); }} />
        </div>
      )}

      {/* Message log */}
      {isExpanded && dmMode && !dmPeer && (
        <div
          className="mb-0.5 p-2"
          style={{
            background: "linear-gradient(180deg, rgba(15,18,40,0.96) 0%, rgba(8,10,24,0.96) 100%)",
            minHeight: 92,
            borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
            borderImage: BTN_FRAME, imageRendering: "pixelated",
            color: "#9a9ab5", fontSize: 8, lineHeight: 1.8,
          }}
        >
          {myWallet
            ? <>Who do you want to message?<br /><span style={{ color: DM_COLOR }}>Type a nickname or wallet below.</span></>
            : "Connect a wallet to send direct messages."}
        </div>
      )}
      {isExpanded && !(dmMode && !dmPeer) && (
        <div
          ref={logRef}
          className="overflow-y-auto mb-0.5 p-2"
          style={{
            background: "linear-gradient(180deg, rgba(15,18,40,0.96) 0%, rgba(8,10,24,0.96) 100%)",
            // With the keyboard up in landscape there is very little height
            // left, so the log gives way and keeps the input on screen.
            maxHeight: typing && isTouch ? Math.max(56, keyboard.visible - 130) : 210,
            minHeight: typing && isTouch ? 0 : 92,
            borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
            borderImage: BTN_FRAME, imageRendering: "pixelated",
            backdropFilter: "blur(3px)",
            overflowX: "hidden", // long words wrap (below) instead of scrolling sideways
          }}
        >
          {messages.length === 0 && (
            <div style={{ color: "#555566", fontSize: 8, lineHeight: 1.8 }}>
              {dmMode ? `Say hi to ${peerName}. Messages wait for them for a day.` : "No messages yet. Press Enter to chat."}
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className="leading-relaxed mb-0.5" style={{ fontSize: 8, overflowWrap: "anywhere", wordBreak: "break-word" }}>
              <span style={{ color: msg.color || channelColor }}>
                {msg.senderName}
              </span>
              <span style={{ color: "#444455" }}>{"> "}</span>
              <span style={{ color: "#d6d6e8" }}>{msg.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Emoji bar */}
      {showEmojis && (
        <div
          className="flex gap-1 p-1.5 mb-0.5"
          style={chamferBox(6, {
            background: "rgba(10,10,30,0.92)",
            border: "1px solid rgba(153,69,255,0.2)",
            backdropFilter: "blur(2px)",
          })}
        >
          {EMOJI_REGISTRY.map((em) => (
            <button
              key={em.id}
              // The emote itself makes a sound (in showEmoji); opt out of the
              // generic UI click so they don't overlap.
              data-sfx="off"
              onClick={() => {
                gameRef?.events.emit("emoji:trigger", em);
                setShowEmojis(false);
              }}
              className="px-2 py-1 text-xs cursor-pointer"
              style={chamferBox(4, {
                background: `${em.color}15`,
                color: em.color,
                border: `1px solid ${em.color}30`,
                fontFamily: '"Press Start 2P", monospace',
                fontSize: "7px",
                display: "flex",
                alignItems: "center",
                gap: 4,
              })}
              title={`${em.label} [${em.key}]`}
            >
              <span>{em.symbol}</span>
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div className="mb-0.5 px-2 py-1" style={chamferBox(4, {
          background: "rgba(255,80,80,0.12)", border: "1px solid rgba(255,80,80,0.4)", 
          color: "#ff8a8a", fontSize: 7, lineHeight: 1.6,
        })}>
          {notice}
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-1">
        <button
          onClick={() => { setShowEmojis(v => !v); }}
          className="cursor-pointer flex items-center justify-center"
          style={{
            width: 28, height: 28, flexShrink: 0,
            background: "rgba(10,10,30,0.94)",
            color: showEmojis ? "#B7E928" : "#555566",
            borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
            borderImage: BTN_FRAME, imageRendering: "pixelated",
          }}
          title="Emotes"
        >
          <img
            src="/assets/ui/ico_chat.png" width={16} height={16} alt="Emotes" draggable={false}
            style={{ imageRendering: "pixelated", display: "block", opacity: showEmojis ? 1 : 0.75 }}
          />
        </button>
        <button
          onClick={() => { window.dispatchEvent(new Event("solcity:openExpressionWheel")); setShowEmojis(false); }}
          className="cursor-pointer flex items-center justify-center"
          style={{
            width: 28, height: 28, flexShrink: 0,
            background: "rgba(10,10,30,0.94)",
            color: "#c084fc",
            borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
            borderImage: BTN_FRAME, imageRendering: "pixelated",
          }}
          title="Face expressions"
        >
          <img
            src="/assets/ui/ico_emoji.png" width={16} height={16} alt="Face expressions" draggable={false}
            style={{ imageRendering: "pixelated", display: "block" }}
          />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setNotice(null); }}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          enterKeyHint="send"
          placeholder={placeholder}
          maxLength={140}
          className="flex-1 px-2 outline-none"
          style={{
            height: 28,
            background: "rgba(10,10,30,0.94)",
            color: "#d9d9ec",
            borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
            borderImage: BTN_FRAME, imageRendering: "pixelated",
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 8,
          }}
        />
        {/* Send button on every device: touch keyboards don't always surface
            a reliable Enter, and on desktop it shows there is a way to send. */}
        {(
          <button
            // Keep focus in the input so a desktop player can keep typing.
            onPointerDown={(e) => { if (!isTouch) e.preventDefault(); }}
            onClick={() => void handleSend()}
            disabled={!input.trim() || busy}
            className="cursor-pointer flex items-center justify-center"
            style={{
              width: 28, height: 28, flexShrink: 0,
              background: input.trim() ? "rgba(183,233,40,0.18)" : "rgba(10,10,30,0.94)",
              color: input.trim() ? "#B7E928" : "#555566",
              borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
              borderImage: BTN_FRAME, imageRendering: "pixelated",
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 10,
              WebkitTapHighlightColor: "transparent",
            }}
            title="Send"
          >
            ▶
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ label, active, unread = 0, onClick }: { label: string; active: boolean; unread?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 relative"
      style={chamferBox(4, {
        flexShrink: 0, whiteSpace: "nowrap", cursor: "pointer", fontSize: 7,
        fontFamily: '"Press Start 2P", monospace',
        background: active ? "rgba(255,215,0,0.14)" : "transparent",
        color: active ? DM_COLOR : "#8a8aa5",
        border: `1px solid ${active ? "rgba(255,215,0,0.5)" : "rgba(153,69,255,0.25)"}`,
      })}
    >
      {label}
      {unread > 0 && (
        <span style={{
          position: "absolute", top: 3, right: 3, width: 6, height: 6, borderRadius: "50%",
          background: DM_COLOR,
        }} />
      )}
    </button>
  );
}

function TabButton({
  label,
  color,
  active,
  badge,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 transition-colors relative"
      style={{
        background: "rgba(10,10,30,0.5)",
        color: active ? color : "#555566",
        borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
        borderImage: BTN_FRAME, imageRendering: "pixelated",
        cursor: "pointer",
        fontSize: 8,
      }}
    >
      {active && (
        <span
          aria-hidden
          style={{
            position: "absolute", inset: 0,
            borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
            borderImage: BTN_FRAME_FILL, imageRendering: "pixelated",
            opacity: 0.3,
          }}
        />
      )}
      <span style={{ position: "relative" }}>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute -top-1 -right-1 px-1 rounded-full"
          style={{
            background: color,
            color: "#000",
            fontSize: "7px",
            fontWeight: "bold",
            minWidth: "14px",
            textAlign: "center",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
