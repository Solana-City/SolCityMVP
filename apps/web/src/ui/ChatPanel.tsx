"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatManager, ChatMessage, ChatChannel, DMChannel } from "@/game/chat/ChatManager";
import { getChannelColor, getChannelLabel } from "@/game/chat/ChatManager";
import { EMOJI_REGISTRY } from "@/game/chat/EmojiSystem";

interface ChatPanelProps {
  gameRef: Phaser.Game | null;
  visible?: boolean;
}

export default function ChatPanel({ gameRef, visible = true }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [activeChannel, setActiveChannel] = useState<ChatChannel>("local");
  const [dmChannels, setDmChannels] = useState<DMChannel[]>([]);
  const [isTouch, setIsTouch] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showEmojis, setShowEmojis] = useState(false);

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

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !gameRef) return;
    gameRef.events.emit("chat:send", text);
    setInput("");
    setShowEmojis(false);
  }, [input, gameRef]);

  const handleFocus = useCallback(() => {
    gameRef?.events.emit("chat:focus", true);
    // On mobile, scroll the input into view after the virtual keyboard rises.
    // Small delay lets the keyboard animate before measuring layout.
    if (isTouch) {
      setTimeout(() => inputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 320);
    }
  }, [gameRef, isTouch]);

  const handleBlur = useCallback(() => {
    gameRef?.events.emit("chat:focus", false);
  }, [gameRef]);

  const switchChannel = useCallback((ch: ChatChannel) => {
    setActiveChannel(ch);
    chatManager?.setActiveChannel(ch);
  }, [chatManager]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSend();
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

  // On mobile the parent controls visibility; on desktop always show
  if (isTouch && !visible) return null;

  const channelColor = getChannelColor(activeChannel);

  const fixedTabs: ChatChannel[] = ["local", "global"];

  return (
    <div
      className="fixed z-20"
      style={{
        left: "max(env(safe-area-inset-left, 0px), 16px)",
        bottom: isTouch
          ? "calc(env(safe-area-inset-bottom, 0px) + 156px)"
          : "16px",
        width: isTouch ? "min(280px, calc(100vw - 180px))" : "360px",
        fontFamily: '"Press Start 2P", monospace',
      }}
    >
      {!isTouch && (
        <div className="text-[10px] mb-1 px-1" style={{ color: "#7a7a9a" }}>
          Enter: chat • Esc: close input • 1-6: emotes
        </div>
      )}
      {/* Channel tabs */}
      <div className="flex gap-0.5 mb-0.5 overflow-x-auto">
        {fixedTabs.map((ch) => (
          <TabButton
            key={ch}
            label={getChannelLabel(ch, dmChannels)}
            color={getChannelColor(ch)}
            active={activeChannel === ch}
            onClick={() => switchChannel(ch)}
          />
        ))}
        {dmChannels.map((dm) => {
          const ch: ChatChannel = `dm:${dm.sessionId}`;
          return (
            <TabButton
              key={ch}
              label={dm.name}
              color="#FFD700"
              active={activeChannel === ch}
              badge={dm.unread > 0 ? dm.unread : undefined}
              onClick={() => switchChannel(ch)}
            />
          );
        })}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-auto px-2 py-1 text-xs"
          style={{ background: "transparent", color: "#555566", border: "none", cursor: "pointer" }}
        >
          {isExpanded ? "\u25BC" : "\u25B2"}
        </button>
      </div>

      {/* Message log */}
      {isExpanded && (
        <div
          ref={logRef}
          className="overflow-y-auto mb-0.5 p-2 rounded-b"
          style={{
            background: "linear-gradient(180deg, rgba(15,18,40,0.96) 0%, rgba(8,10,24,0.96) 100%)",
            maxHeight: 210,
            minHeight: 92,
            border: "1px solid rgba(153,69,255,0.2)",
            borderTop: "none",
            backdropFilter: "blur(3px)",
          }}
        >
          {messages.length === 0 && (
            <div className="text-xs" style={{ color: "#333344" }}>
              No messages yet. Press Enter to chat.
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className="text-xs leading-relaxed mb-0.5">
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
          className="flex gap-1 p-1.5 rounded mb-0.5"
          style={{
            background: "rgba(10,10,30,0.92)",
            border: "1px solid rgba(153,69,255,0.2)",
            backdropFilter: "blur(2px)",
          }}
        >
          {EMOJI_REGISTRY.map((em) => (
            <button
              key={em.id}
              onClick={() => {
                gameRef?.events.emit("emoji:trigger", em);
                setShowEmojis(false);
              }}
              className="px-2 py-1 rounded text-xs cursor-pointer"
              style={{
                background: `${em.color}15`,
                color: em.color,
                border: `1px solid ${em.color}30`,
                fontFamily: '"Press Start 2P", monospace',
                fontSize: "7px",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              title={`${em.label} [${em.key}]`}
            >
              <span>{em.uiSymbol}</span>
              <span>{em.symbol}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-1">
        <button
          onClick={() => setShowEmojis(!showEmojis)}
          className="px-2 rounded text-sm cursor-pointer"
          style={{
            background: "rgba(10,10,30,0.94)",
            color: showEmojis ? "#14F195" : "#555566",
            border: "1px solid rgba(153,69,255,0.2)",
          }}
          title="Emojis"
        >
          🎭
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={`${getChannelLabel(activeChannel, dmChannels)} chat...`}
          maxLength={140}
          className="flex-1 px-2 py-1.5 text-xs rounded outline-none"
          style={{
            background: "rgba(10,10,30,0.94)",
            color: "#d9d9ec",
            border: "1px solid rgba(153,69,255,0.2)",
            fontFamily: '"Press Start 2P", monospace',
          }}
        />
      </div>
    </div>
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
      className="px-2 py-1 text-xs rounded-t transition-colors relative"
      style={{
        background: active ? "rgba(10,10,30,0.92)" : "rgba(10,10,30,0.5)",
        color: active ? color : "#555566",
        border: "none",
        cursor: "pointer",
        borderBottom: active ? `2px solid ${color}` : "2px solid transparent",
      }}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute -top-1 -right-1 px-1 rounded-full text-xs"
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
