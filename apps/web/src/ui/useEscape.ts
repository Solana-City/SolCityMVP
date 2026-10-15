"use client";

import { useEffect, useRef } from "react";

/**
 * Escape closes the window on top, and only that one.
 *
 * Every panel used to put its own Escape listener on the window. One press
 * then closed every panel that happened to be open together (the city tour
 * went with the keys card on top of it, never seen), and a panel that forgot
 * to listen could not be closed from the keyboard at all: the wardrobe, a
 * player's card, the nickname window.
 *
 * A panel registers here instead, for as long as it is open. The most recent
 * one still open gets the press; the ones under it wait their turn, so each
 * Escape peels off one layer. A mini-game registers `null` while it is up: the
 * game answers Escape itself, and nothing under it should close.
 *
 * Presses another handler already claimed (preventDefault) are left alone —
 * the leave-the-round confirm, for one, catches Escape on its way down.
 */
type Entry = { close: (() => void) | null };

const stack: Entry[] = [];
let listening = false;

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top?.close) return;
  e.preventDefault();
  top.close();
}

/**
 * Closes this panel on Escape while `active`, if it is the topmost one open.
 * `null` holds the top without closing anything, for a layer that handles
 * Escape on its own.
 */
export function useEscape(onClose: (() => void) | null, active = true): void {
  const latest = useRef(onClose);
  useEffect(() => { latest.current = onClose; });
  const barrier = onClose === null;

  useEffect(() => {
    if (!active) return;
    const entry: Entry = { close: barrier ? null : () => latest.current?.() };
    stack.push(entry);
    if (!listening) {
      window.addEventListener("keydown", onKeyDown);
      listening = true;
    }
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active, barrier]);
}
