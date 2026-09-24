"use client";

/**
 * The part of the screen a panel can actually use.
 *
 * A `position: fixed; inset: 0` element is laid out against the LARGE mobile
 * viewport, the one you get with the browser's address bar hidden. While the
 * bar is showing, that box extends past the bottom of the screen: a centred
 * panel sits too low and a bottom sheet has its lower half cut off. The
 * on-screen keyboard does the same thing, only worse.
 *
 * `visualViewport` reports what is really visible, including how far the page
 * has been scrolled under the bar, so overlays anchored to it always land
 * inside the screen. Without the API (older browsers) the caller falls back to
 * inset: 0, which is what it did before.
 */
import { useEffect, useState } from "react";

export interface ViewportBox {
  top: number;
  height: number;
}

export function useViewportBox(): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBox({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return box;
}

/** Root style for a full-screen overlay that fits the visible viewport. */
export function overlayBox(box: ViewportBox | null): React.CSSProperties {
  return box
    ? { position: "fixed", left: 0, right: 0, top: box.top, height: box.height }
    : { position: "fixed", inset: 0 };
}
