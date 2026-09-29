"use client";

import { useEffect, useRef, useState } from "react";

const JOYSTICK_RADIUS = 34; // px — max thumb travel from center
const PAD_PX = 100;   // the pad's art size at phone scale
const THUMB_PX = 44;  // the cross that rides on it

// Pixel-art control sprites (public/assets/ui). Rendered at 1x or 1.5x of
// their native size so device-pixel scaling stays close to integer.
const UI = "/assets/ui";
const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

function emitGame(event: string, data?: unknown) {
  (globalThis as any).__solCityGameEvents?.emit(event, data);
}

// ── Joystick ────────────────────────────────────────────────────────────────

function Joystick({ scale = 1 }: { scale?: number }) {
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
    const clamped = Math.min(dist, JOYSTICK_RADIUS * scale);
    const angle = Math.atan2(dy, dx);
    const tx = Math.cos(angle) * clamped;
    const ty = Math.sin(angle) * clamped;

    if (thumbRef.current) thumbRef.current.style.transform = `translate(${tx}px,${ty}px)`;
    // Normalised by the SCALED radius, or a tablet's bigger pad would report
    // more than full speed at the edge of its travel.
    const travel = JOYSTICK_RADIUS * scale;
    emitGame("touch:joystick", { dx: tx / travel, dy: ty / travel });
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
        width: PAD_PX * scale,
        height: PAD_PX * scale,
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
        src={`${UI}/controller_bg2.png`}
        width={PAD_PX * scale}
        height={PAD_PX * scale}
        alt=""
        draggable={false}
        style={{ ...PIXELATED, position: "absolute", inset: 0, opacity: 0.9 }}
      />
      <img
        ref={thumbRef}
        src={`${UI}/controller2.png`}
        width={THUMB_PX * scale}
        height={THUMB_PX * scale}
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
        // Hold the pointer until it is released. ACT fires on the press, and
        // whatever it opens (an NPC panel, a mini-game) appears under the
        // finger: without capture the release lands on that new panel and
        // closes it, so the panel blinked open and shut. With capture the
        // whole gesture belongs to this button.
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
        setPressed(true);
        onPress();
      }}
      onPointerUp={(e) => {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        setPressed(false);
      }}
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
  // A tablet is a touch screen whose SHORT side is big. The pads were placed
  // for a phone, in the far corners at 20px, which on a 1024x1366 iPad is
  // nowhere near either thumb — the 2026-09-27 playtest could not play on one.
  // Hands hold a tablet inboard and higher up, so the controls follow.
  const [tablet, setTablet] = useState(false);

  useEffect(() => {
    const sizeMq = window.matchMedia("(min-width: 700px) and (min-height: 700px)");
    setTablet(sizeMq.matches);
    const onSize = (e: MediaQueryListEvent) => setTablet(e.matches);
    sizeMq.addEventListener("change", onSize);

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

  return (
    <>
      {/* Bottom bar */}
      <div
        className="fixed z-30 bottom-0 left-0 right-0 flex justify-between items-end pointer-events-none"
        style={{
          // Phone: hard against the corners, which is where thumbs are on a
          // device held in two hands. Tablet: pulled inboard and up, in
          // percentages so it follows the screen instead of a fixed guess.
          paddingLeft: tablet
            ? "max(env(safe-area-inset-left, 0px), 7vw)"
            : "max(env(safe-area-inset-left, 0px), 20px)",
          paddingRight: tablet
            ? "max(env(safe-area-inset-right, 0px), 7vw)"
            : "max(env(safe-area-inset-right, 0px), 20px)",
          paddingBottom: tablet
            ? "max(env(safe-area-inset-bottom, 0px), 9vh)"
            : "max(env(safe-area-inset-bottom, 0px), 20px)",
        }}
      >
        {/* Left — joystick */}
        <div className="pointer-events-auto">
          <Joystick scale={tablet ? 1.3 : 1} />
        </div>

        {/* Right — ACT: interacts with NPCs and advances open dialogs */}
        <div className="pointer-events-auto">
          <SpriteButton
            bg={`${UI}/btn_act_bg2.png`}
            icon={`${UI}/btn_act2.png`}
            size={tablet ? 113 : 87}
            alt="ACT"
            onPress={handleInteract}
          />
        </div>
      </div>
    </>
  );
}
