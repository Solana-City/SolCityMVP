"use client";

import { useEffect } from "react";

const STORAGE_KEY = "solcity:zoom";
// Must match CityScene / ZoomControl: only multiples of 2 are pixel-perfect
// with the current sprite_scale=0.5 setting.
const VALID_ZOOMS = [2, 4] as const;

function snapZoom(z: number): number {
  return VALID_ZOOMS.reduce((best, v) =>
    Math.abs(v - z) < Math.abs(best - z) ? v : best
  );
}

function currentZoom(): number {
  const stored = parseFloat(localStorage.getItem(STORAGE_KEY) ?? "");
  return isNaN(stored) ? 2 : snapZoom(stored);
}

function broadcastZoom(zoom: number) {
  (globalThis as any).__solCityGameEvents?.emit("camera:zoom", zoom);
  window.dispatchEvent(new CustomEvent("solcity:zoom", { detail: zoom }));
}

export function usePinchZoom() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const pts = new Map<number, { x: number; y: number }>();
    let startDist = 0;
    let startZoom = 1;
    let lastRaw = 1;

    function dist() {
      const [a, b] = [...pts.values()];
      return Math.hypot(b.x - a.x, b.y - a.y);
    }

    function onDown(e: PointerEvent) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        startDist = dist();
        startZoom = currentZoom();
        lastRaw = startZoom;
      }
    }

    function onMove(e: PointerEvent) {
      if (!pts.has(e.pointerId) || pts.size < 2) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const ratio = dist() / startDist;
      const raw = Math.min(VALID_ZOOMS[VALID_ZOOMS.length - 1],
                           Math.max(VALID_ZOOMS[0], startZoom * ratio));
      // Only emit when raw value shifts enough to avoid noise
      if (Math.abs(raw - lastRaw) < 0.5) return;
      lastRaw = raw;
      broadcastZoom(snapZoom(raw)); // emit snapped value immediately
    }

    function onUp(e: PointerEvent) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2 && startDist > 0) {
        // Snap to nearest 0.25 on finger lift
        const snapped = snapZoom(lastRaw);
        broadcastZoom(snapped);
        localStorage.setItem(STORAGE_KEY, String(snapped));
        startDist = 0;
      }
    }

    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);

    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, []);
}
