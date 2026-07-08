"use client";

import { useEffect } from "react";
import { getValidZooms, snapZoom, loadZoom, saveZoom } from "@/game/config/zoomConfig";

function broadcastZoom(zoom: number) {
  (globalThis as any).__solCityGameEvents?.emit("camera:zoom", zoom);
  window.dispatchEvent(new CustomEvent("solcity:zoom", { detail: zoom }));
}

export function usePinchZoom() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const pts = new Map<number, { x: number; y: number }>();
    let startDist = 0;
    let startZoom = 2;
    let lastSnapped = 2;

    function dist() {
      const [a, b] = [...pts.values()];
      return Math.hypot(b.x - a.x, b.y - a.y);
    }

    function onDown(e: PointerEvent) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        startDist = dist();
        startZoom = loadZoom();
        lastSnapped = startZoom;
      }
    }

    function onMove(e: PointerEvent) {
      if (!pts.has(e.pointerId) || pts.size < 2) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const zooms = getValidZooms();
      const ratio = dist() / startDist;
      const raw = Math.min(zooms[zooms.length - 1],
                           Math.max(zooms[0], startZoom * ratio));
      const snapped = snapZoom(raw);
      if (snapped === lastSnapped) return;
      lastSnapped = snapped;
      broadcastZoom(snapped);
    }

    function onUp(e: PointerEvent) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2 && startDist > 0) {
        broadcastZoom(lastSnapped);
        saveZoom(lastSnapped);
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
