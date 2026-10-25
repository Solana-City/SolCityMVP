"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const JOYSTICK_RADIUS = 34; // px — max thumb travel from center
const PAD_PX = 100;   // the pad's art size at phone scale
const THUMB_PX = 44;  // the cross that rides on it

// Chat and expressions sit on an arc round ACT's upper left, where the right
// thumb already is, rather than on a rail at the far end of the screen. The two
// sit at this radius so that their 44px tap boxes overlap neither each other
// nor ACT's own (it is 72px across): Chat to its left, React above that.
const ARC_RADIUS = 76;          // px from ACT's center, at phone scale
const ARC_ANGLES = [-171, -124]; // degrees per button; 0 = right of ACT, 180 = left, negative = up
const ACT_PX = 72;              // ACT's art size at phone scale

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

/**
 * How far the controls stand off one screen edge. Phone: hard against the
 * corners, which is where thumbs are on a device held in two hands. Tablet:
 * pulled inboard and up, in percentages so it follows the screen instead of a
 * fixed guess.
 */
function edge(side: "left" | "right" | "bottom", tablet: boolean): string {
  const off = !tablet ? "20px" : side === "bottom" ? "9vh" : "7vw";
  return `max(env(safe-area-inset-${side}, 0px), ${off})`;
}

export default function MobileControls({ besideAct, raised = false }: {
  /** Buttons placed on the arc beside ACT, in ARC_ANGLES order. */
  besideAct?: ReactNode[];
  /** Lift those buttons above the expression wheel's backdrop (z 45), so the
      one that closes the wheel stays visible and tappable while it is open. */
  raised?: boolean;
}) {
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

  const scale = tablet ? 1.3 : 1;
  const actSize = tablet ? 113 : ACT_PX;
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
          paddingLeft: edge("left", tablet),
          paddingRight: edge("right", tablet),
          paddingBottom: edge("bottom", tablet),
        }}
      >
        {/* Left — joystick */}
        <div className="pointer-events-auto">
          <Joystick scale={scale} />
        </div>

        {/* Right — ACT: interacts with NPCs and advances open dialogs */}
        <div className="pointer-events-auto">
          <SpriteButton
            bg={`${UI}/btn_act_bg2.png`}
            icon={`${UI}/btn_act2.png`}
            size={actSize}
            alt="ACT"
            onPress={handleInteract}
          />
        </div>
      </div>

      {/* The arc beside ACT. A layer of its own, laid exactly over the button,
          rather than inside the bar: the bar's z-index caps anything in it, and
          `raised` has to lift these buttons alone above the wheel. */}
      {besideAct && besideAct.length > 0 && (
        <div
          className="fixed pointer-events-none"
          style={{
            zIndex: raised ? 46 : 30,
            right: edge("right", tablet),
            bottom: edge("bottom", tablet),
            width: actSize,
            height: actSize,
          }}
        >
          {besideAct.map((button, i) => {
            const a = ((ARC_ANGLES[i] ?? 0) * Math.PI) / 180;
            // Whole pixels, so the pixel-art icons are not resampled.
            const x = Math.round(Math.cos(a) * ARC_RADIUS * (actSize / ACT_PX));
            const y = Math.round(Math.sin(a) * ARC_RADIUS * (actSize / ACT_PX));
            return (
              <div
                key={i}
                className="pointer-events-auto"
                style={{
                  position: "absolute", left: "50%", top: "50%",
                  transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
                }}
              >
                {button}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
