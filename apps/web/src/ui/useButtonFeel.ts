"use client";

import { useState, type CSSProperties } from "react";

export interface ButtonFeel {
  hover: boolean;
  pressed: boolean;
  handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onPointerDown: () => void;
    onPointerUp: () => void;
  };
}

/**
 * Hover + press tracking shared by every clickable control in the HUD, so
 * each button only has to say how hover/press should look, not how to
 * detect them. Leaving on mid-press (dragging off a held button) clears the
 * press too — nothing should stay "stuck down" once the pointer is gone.
 */
export function useButtonFeel(): ButtonFeel {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  return {
    hover,
    pressed,
    handlers: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => { setHover(false); setPressed(false); },
      onPointerDown: () => setPressed(true),
      onPointerUp: () => setPressed(false),
    },
  };
}

/**
 * Hover/press as a plain filter + scale, layered on top of whatever a
 * button's own style already is — every color in this HUD is a different
 * literal (hex, rgba, a CSS var), so nudging brightness is the one dial that
 * works the same on all of them instead of each button hand-tuning its own
 * hover/press alphas.
 */
export function feelStyle(
  feel: Pick<ButtonFeel, "hover" | "pressed">,
  opts?: { hoverBrightness?: number; pressBrightness?: number; pressScale?: number },
): CSSProperties {
  const { hoverBrightness = 1.15, pressBrightness = 0.92, pressScale = 0.96 } = opts ?? {};
  return {
    filter: feel.pressed ? `brightness(${pressBrightness})` : feel.hover ? `brightness(${hoverBrightness})` : "none",
    transform: feel.pressed ? `scale(${pressScale})` : "none",
    transition: "filter 0.12s, transform 0.08s",
  };
}
