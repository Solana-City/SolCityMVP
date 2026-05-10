"use client";

import { useEffect, useRef, useState } from "react";
import { EMOJI_REGISTRY } from "@/game/chat/EmojiSystem";

interface MobileControlsProps {
  gameRef: Phaser.Game | null;
  chatOpen: boolean;
  onChatToggle: () => void;
}

const JOYSTICK_RADIUS = 52; // px — max thumb travel from center

function emitGame(event: string, data?: unknown) {
  (globalThis as any).__solCityGameEvents?.emit(event, data);
}

// ── Joystick ────────────────────────────────────────────────────────────────

function Joystick() {
  const outerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  function release() {
    pointerId.current = null;
    if (thumbRef.current) thumbRef.current.style.transform = "translate(0px,0px)";
    emitGame("touch:stop");
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerId.current = e.pointerId;
    const rect = outerRef.current!.getBoundingClientRect();
    origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== e.pointerId) return;
    const dx = e.clientX - origin.current.x;
    const dy = e.clientY - origin.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clamped = Math.min(dist, JOYSTICK_RADIUS);
    const angle = Math.atan2(dy, dx);
    const tx = Math.cos(angle) * clamped;
    const ty = Math.sin(angle) * clamped;

    if (thumbRef.current) thumbRef.current.style.transform = `translate(${tx}px,${ty}px)`;
    emitGame("touch:joystick", { dx: tx / JOYSTICK_RADIUS, dy: ty / JOYSTICK_RADIUS });
  }

  return (
    <div
      ref={outerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      style={{
        width: 120,
        height: 120,
        borderRadius: "50%",
        background: "rgba(153,69,255,0.12)",
        border: "2px solid rgba(153,69,255,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        touchAction: "none",
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      <div
        ref={thumbRef}
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "rgba(153,69,255,0.55)",
          border: "2px solid rgba(153,69,255,0.85)",
          pointerEvents: "none",
          willChange: "transform",
        }}
      />
    </div>
  );
}

// ── Action buttons ───────────────────────────────────────────────────────────

function ActionButton({
  label,
  color,
  onPress,
}: {
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); onPress(); }}
      style={{
        width: 60,
        height: 60,
        borderRadius: "50%",
        background: `${color}1a`,
        border: `2px solid ${color}88`,
        color,
        fontSize: "11px",
        fontFamily: '"Press Start 2P", monospace',
        cursor: "pointer",
        touchAction: "none",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function MobileControls({ gameRef, chatOpen, onChatToggle }: MobileControlsProps) {
  const [isTouch, setIsTouch] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!isTouch) return null;

  const handleInteract = () => emitGame("touch:interact");
  const handleEmoji = (emoji: (typeof EMOJI_REGISTRY)[number]) => {
    emitGame("emoji:trigger", emoji);
    setShowEmojis(false);
  };

  return (
    <>
      {/* Emoji picker — above the action cluster */}
      {showEmojis && (
        <div
          className="fixed z-30 flex flex-wrap gap-2 p-3 rounded-xl"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 160px)",
            right: "max(env(safe-area-inset-right, 0px), 16px)",
            background: "rgba(10,10,30,0.94)",
            border: "1px solid rgba(153,69,255,0.3)",
            backdropFilter: "blur(6px)",
            maxWidth: 200,
          }}
        >
          {EMOJI_REGISTRY.map((em) => (
            <button
              key={em.id}
              onPointerDown={(e) => { e.preventDefault(); handleEmoji(em); }}
              style={{
                background: `${em.color}20`,
                border: `1px solid ${em.color}44`,
                borderRadius: 8,
                padding: "6px 8px",
                color: em.color,
                fontSize: "10px",
                fontFamily: '"Press Start 2P", monospace',
                cursor: "pointer",
                touchAction: "none",
              }}
              title={em.label}
            >
              {em.uiSymbol}
            </button>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <div
        className="fixed z-30 bottom-0 left-0 right-0 flex justify-between items-end pointer-events-none"
        style={{
          paddingLeft: "max(env(safe-area-inset-left, 0px), 20px)",
          paddingRight: "max(env(safe-area-inset-right, 0px), 20px)",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
        }}
      >
        {/* Left — joystick */}
        <div className="pointer-events-auto">
          <Joystick />
        </div>

        {/* Right — action buttons */}
        <div className="pointer-events-auto flex flex-col items-center gap-3">
          <ActionButton label="[E]" color="#14F195" onPress={handleInteract} />
          <ActionButton
            label={showEmojis ? "✕" : "☺"}
            color="#9945FF"
            onPress={() => setShowEmojis((v) => !v)}
          />
        </div>
      </div>

      {/* Chat toggle — top-left, below the score HUD */}
      <div
        className="fixed pointer-events-auto z-30"
        style={{ top: 96, left: 16 }}
      >
        <ActionButton
          label={chatOpen ? "✕" : "💬"}
          color="#00D1FF"
          onPress={onChatToggle}
        />
      </div>
    </>
  );
}
