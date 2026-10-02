"use client";

import { useCallback, useEffect, useState } from "react";
import { reloadWithReason } from "./reloadReason";
import { chamferBox } from "@/ui/chamfer";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";

/**
 * Service-worker updates that do not interrupt anybody.
 *
 * A new deploy used to take effect the moment it was noticed: the waiting
 * worker was told to activate, it took control, and the page reloaded on the
 * spot. On a day with a dozen pushes that is a dozen interruptions per open
 * tab — the city blinks, the player lands back at the fountain, and if the
 * wallet does not auto-connect they have to press connect again. Players
 * reported it as "random disconnections, almost every time", which is exactly
 * what it looks like from the other side of the screen.
 *
 * So an update now waits for a moment that costs nothing:
 *   - the tab goes to the background: applied immediately, invisibly;
 *   - the player asks for it: a chip in the corner, one click;
 *   - nothing else: it applies on the next natural load.
 *
 * The old build keeps running meanwhile, which is safe — the new worker is
 * never told to activate until then, so no precache is purged under a page
 * that is still using it. (A build that fails to load a chunk anyway is
 * caught by ChunkReloadGuard, which reloads and says so.)
 */
export default function SWUpdater() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  /** Why the PREVIOUS load reloaded itself, if it did — see reloadReason. */
  const [reloadNote, setReloadNote] = useState<string | null>(null);

  const apply = useCallback((sw: ServiceWorker | null) => {
    if (!sw) return;
    sw.postMessage({ type: "SKIP_WAITING" });
  }, []);

  useEffect(() => {
    const onReason = (e: Event) => {
      const detail = (e as CustomEvent<{ reason: string }>).detail;
      if (!detail?.reason) return;
      setReloadNote(detail.reason);
      setTimeout(() => setReloadNote(null), 9000);
    };
    window.addEventListener("solcity:reload-reason", onReason);
    return () => window.removeEventListener("solcity:reload-reason", onReason);
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let reloaded = false;
    const onControllerChange = () => {
      // The new worker has taken control: the page must not keep running on a
      // precache that is being replaced.
      if (reloaded) return;
      reloaded = true;
      reloadWithReason("new build deployed");
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // A waiting worker is an update that is READY, not one that is applied.
    const noteWaiting = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
    };

    let registration: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      registration = reg;
      noteWaiting(reg);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed") noteWaiting(reg);
        });
      });
    }).catch(() => {});

    const check = () => registration?.update().catch(() => {});
    const interval = setInterval(check, 60_000);

    // Leaving the tab is the free moment: apply there, and the player comes
    // back to the new build with nothing having interrupted them.
    const onVisibility = () => {
      if (document.visibilityState === "visible") { check(); return; }
      setWaiting((w) => { apply(w); return w; });
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, [apply]);

  const updateFeel = useButtonFeel();

  if (!waiting && !reloadNote) return null;

  return (
    <div
      style={{
        position: "fixed", left: "50%", bottom: 18, transform: "translateX(-50%)",
        zIndex: 120, display: "flex", flexDirection: "column", gap: 6, alignItems: "center",
        fontFamily: '"Press Start 2P", monospace', pointerEvents: "none",
      }}
    >
      {reloadNote && (
        <div style={chamferBox(6, {
          padding: "8px 12px", background: "#061A3A",
          color: "#8888aa", fontSize: 7, lineHeight: 1.6,
        })}>
          the city reloaded itself: {reloadNote}
        </div>
      )}
      {waiting && (
        <button
          onClick={() => apply(waiting)}
          {...updateFeel.handlers}
          style={chamferBox(6, {
            padding: "9px 14px", background: "#061A3A",
            color: "#B7E928", border: "1px solid rgba(183,233,40,0.5)",
            fontFamily: "inherit", fontSize: 7, cursor: "pointer", pointerEvents: "auto",
            ...feelStyle(updateFeel),
          })}
        >
          NEW VERSION READY · UPDATE
        </button>
      )}
    </div>
  );
}
