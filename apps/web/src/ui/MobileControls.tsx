"use client";

import { useEffect, useRef, useState } from "react";
import { EMOJI_REGISTRY } from "@/game/chat/EmojiSystem";

const JOYSTICK_RADIUS = 34; // px — max thumb travel from center

// Pixel-art control sprites (public/assets/ui). Rendered at 1x or 1.5x of
// their native size so device-pixel scaling stays close to integer.
const UI = "/assets/ui";
const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

function emitGame(event: string, data?: unknown) {
  (globalThis as any).__solCityGameEvents?.emit(event, data);
}

// ── Joystick ────────────────────────────────────────────────────────────────

function Joystick() {
  const outerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLImageElement>(null);
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
        position: "relative",
        width: 100,
        height: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        touchAction: "none",
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      {/* Pad base — stays put while the cross thumb moves (same center). */}
      <img
        src={`${UI}/controller_bg.png`}
        width={100}
        height={100}
        alt=""
        draggable={false}
        style={{ ...PIXELATED, position: "absolute", inset: 0, opacity: 0.9 }}
      />
      <img
        ref={thumbRef}
        src={`${UI}/controller.png`}
        width={44}
        height={44}
        alt="Joystick"
        draggable={false}
        style={{ ...PIXELATED, pointerEvents: "none", willChange: "transform" }}
      />
    </div>
  );
}

// ── Sprite button (bg layer + pressable top layer) ──────────────────────────
// Per the spriter's contract: the bg layer must never transform on press —
// only the top layer moves, so the button reads as sinking into its base.

function SpriteButton({
  bg,
  icon,
  size,
  alt,
  onPress,
}: {
  bg: string;
  icon: string;
  size: number;
  alt: string;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        setPressed(true);
        onPress();
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        position: "relative",
        width: size,
        height: size,
        padding: 0,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        touchAction: "none",
        userSelect: "none",
        flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <img
        src={bg}
        width={size}
        height={size}
        alt=""
        draggable={false}
        style={{ ...PIXELATED, position: "absolute", inset: 0 }}
      />
      <img
        src={icon}
        width={size}
        height={size}
        alt={alt}
        draggable={false}
        style={{
          ...PIXELATED,
          position: "absolute",
          inset: 0,
          transform: pressed ? "translateY(3px)" : "none",
          transition: "transform 0.08s",
        }}
      />
    </button>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function MobileControls() {
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

  const handleInteract = () => {
    emitGame("touch:interact");
    if (typeof navigator.vibrate === "function") navigator.vibrate(18);
  };
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
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 180px)",
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
                fontSize: "8px",
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
          <SpriteButton
            bg={`${UI}/btn_act_bg.png`}
            icon={`${UI}/btn_act.png`}
            size={87}
            alt="ACT"
            onPress={handleInteract}
          />
          <SpriteButton
            bg={`${UI}/btn_emoji_bg.png`}
            icon={showEmojis ? `${UI}/btn_emoji_X.png` : `${UI}/btn_emoji.png`}
            size={63}
            alt={showEmojis ? "Close emojis" : "Emojis"}
            onPress={() => setShowEmojis((v) => !v)}
          />
        </div>
      </div>
    </>
  );
}
