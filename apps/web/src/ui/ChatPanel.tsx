"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatManager, ChatMessage, ChatChannel } from "@/game/chat/ChatManager";
import { CHANNEL_CONFIG } from "@/game/chat/ChatManager";

interface ChatPanelProps {
  gameRef: Phaser.Game | null;
}

const CHANNELS: ChatChannel[] = ["local", "global", "trade", "system"];

export default function ChatPanel({ gameRef }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [activeChannel, setActiveChannel] = useState<ChatChannel>("local");
  const [isExpanded, setIsExpanded] = useState(true);
  const [chatManager, setChatManager] = useState<ChatManager | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!gameRef) return;

    const checkRegistry = setInterval(() => {
      const scene = gameRef.scene.getScene("CityScene");
      if (scene) {
        const cm = scene.registry.get("chatManager") as ChatManager | undefined;
        if (cm) {
          setChatManager(cm);
          setMessages(cm.getVisibleLog());
          cm.onLogUpdate((log) => setMessages([...log]));
          clearInterval(checkRegistry);
        }
      }
    }, 200);

    return () => clearInterval(checkRegistry);
  }, [gameRef]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !gameRef) return;

    gameRef.events.emit("chat:send", text);
    setInput("");
  }, [input, gameRef]);

  const handleFocus = useCallback(() => {
    gameRef?.events.emit("chat:focus", true);
  }, [gameRef]);

  const handleBlur = useCallback(() => {
    gameRef?.events.emit("chat:focus", false);
  }, [gameRef]);

  const switchChannel = useCallback((ch: ChatChannel) => {
    setActiveChannel(ch);
    chatManager?.setActiveChannel(ch);
  }, [chatManager]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSend();
    }
    if (e.key === "Escape") {
      inputRef.current?.blur();
    }
    e.stopPropagation();
  }, [handleSend]);

  // Global Enter key to focus chat
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

  const filteredMessages = activeChannel === "local"
    ? messages
    : messages.filter((m) => m.channel === activeChannel || m.channel === "system");

  return (
    <div
      className="fixed bottom-4 left-4 z-20"
      style={{ width: 340, fontFamily: '"Fira Code", monospace' }}
    >
      {/* Channel tabs */}
      <div className="flex gap-0.5 mb-0.5">
        {CHANNELS.map((ch) => {
          const cfg = CHANNEL_CONFIG[ch];
          const isActive = activeChannel === ch;
          return (
            <button
              key={ch}
              onClick={() => switchChannel(ch)}
              className="px-2 py-1 text-xs rounded-t transition-colors"
              style={{
                background: isActive ? "rgba(10,10,30,0.92)" : "rgba(10,10,30,0.5)",
                color: isActive ? cfg.color : "#555566",
                border: "none",
                cursor: "pointer",
                borderBottom: isActive ? `2px solid ${cfg.color}` : "2px solid transparent",
              }}
            >
              {cfg.label}
            </button>
          );
        })}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-auto px-2 py-1 text-xs"
          style={{
            background: "transparent",
            color: "#555566",
            border: "none",
            cursor: "pointer",
          }}
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
            background: "rgba(10,10,30,0.92)",
            maxHeight: 180,
            minHeight: 80,
            border: "1px solid rgba(153,69,255,0.15)",
            borderTop: "none",
          }}
        >
          {filteredMessages.length === 0 && (
            <div className="text-xs" style={{ color: "#333344" }}>
              No messages yet. Press Enter to chat.
            </div>
          )}
          {filteredMessages.map((msg) => {
            const cfg = CHANNEL_CONFIG[msg.channel];
            return (
              <div key={msg.id} className="text-xs leading-relaxed mb-0.5">
                {msg.channel !== "local" && msg.channel !== "system" && (
                  <span style={{ color: cfg.color, opacity: 0.6 }}>
                    {cfg.prefix}
                  </span>
                )}
                <span style={{ color: msg.color || cfg.color }}>
                  {msg.senderName}
                </span>
                <span style={{ color: "#444455" }}>{": "}</span>
                <span style={{ color: "#ccccdd" }}>{msg.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-1">
        <span
          className="flex items-center px-2 text-xs rounded-l"
          style={{
            background: "rgba(10,10,30,0.92)",
            color: CHANNEL_CONFIG[activeChannel].color,
            border: "1px solid rgba(153,69,255,0.15)",
            borderRight: "none",
            minWidth: 20,
          }}
        >
          {CHANNEL_CONFIG[activeChannel].prefix || ">"}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={`${CHANNEL_CONFIG[activeChannel].label} chat...`}
          maxLength={140}
          className="flex-1 px-2 py-1.5 text-xs rounded-r outline-none"
          style={{
            background: "rgba(10,10,30,0.92)",
            color: "#ccccdd",
            border: "1px solid rgba(153,69,255,0.15)",
            fontFamily: '"Fira Code", monospace',
          }}
        />
      </div>
    </div>
  );
}
