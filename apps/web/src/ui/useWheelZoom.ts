"use client";

/**
 * Scroll to zoom, on the city itself.
 *
 * Bound to the canvas rather than the window, so a wheel over a panel still
 * scrolls that panel, and it walks the same ladder the + and − buttons walk:
 * one step per gesture, never a free-floating zoom that would land between
 * the steps the screen can draw.
 */
import { useEffect } from "react";
import { getValidZooms, loadZoom, saveZoom, snapZoom } from "@/game/config/zoomConfig";

/** Trackpads fire many small deltas; one step per gesture, not per event. */
const GESTURE_MS = 120;

export function useWheelZoom(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let current = snapZoom(loadZoom());
    let last = 0;

    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || target.tagName !== "CANVAS") return;
      e.preventDefault();

      const now = performance.now();
      if (now - last < GESTURE_MS) return;
      last = now;

      const zooms = getValidZooms();
      const idx = zooms.indexOf(current);
      const at = idx >= 0 ? idx : zooms.indexOf(snapZoom(current));
      // Wheel down (positive deltaY) pulls the camera back, which is what
      // every map in the world does.
      const next = zooms[Math.min(zooms.length - 1, Math.max(0, at + (e.deltaY > 0 ? -1 : 1)))];
      if (next === undefined || next === current) return;

      current = next;
      saveZoom(next);
      // Same two messages the + and − buttons send: one for the scene, one
      // for the control so its label follows.
      (globalThis as { __solCityGameEvents?: { emit: (e: string, d?: unknown) => void } })
        .__solCityGameEvents?.emit("camera:zoom", next);
      window.dispatchEvent(new CustomEvent("solcity:zoom", { detail: next }));
    };

    // Not passive: the page must not scroll under the city.
    window.addEventListener("wheel", onWheel, { passive: false });
    const onZoom = (e: Event) => { current = snapZoom((e as CustomEvent<number>).detail); };
    window.addEventListener("solcity:zoom", onZoom);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("solcity:zoom", onZoom);
    };
  }, [enabled]);
}
