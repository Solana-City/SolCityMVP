"use client";

/**
 * Sol Mechs — a button that swaps to the Unity held sprite while pressed.
 *
 * Inline styles cannot express `:active`, and the pressed frame is a different
 * image rather than a colour change, so the state is tracked here. Pointer
 * events rather than mouse: the same handler covers touch, and `pointercancel`
 * un-sticks a press that turns into a scroll.
 */
import { useState } from "react";
import { actionButton } from "./theme";

export interface SpriteButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function SpriteButton({ selected, disabled, style, children, ...rest }: SpriteButtonProps) {
  const [held, setHeld] = useState(false);
  const release = () => setHeld(false);
  return (
    <button
      {...rest}
      disabled={disabled}
      onPointerDown={(e) => { if (!disabled) setHeld(true); rest.onPointerDown?.(e); }}
      onPointerUp={(e) => { release(); rest.onPointerUp?.(e); }}
      onPointerLeave={(e) => { release(); rest.onPointerLeave?.(e); }}
      onPointerCancel={(e) => { release(); rest.onPointerCancel?.(e); }}
      style={{ ...actionButton({ selected, disabled: !!disabled, held: held && !disabled }), ...style }}
    >
      {children}
    </button>
  );
}

export default SpriteButton;
