"use client";

import { useEffect } from "react";

/**
 * Seamless service-worker updates — so a broken/old cached build recovers on
 * its own instead of trapping the user until they "close all tabs".
 *
 * The build keeps `skipWaiting: false` (a new SW auto-taking-over a running tab
 * purges its precache → "Loading chunk X failed"). This controller gets the
 * same result safely: when a new SW is WAITING, it tells that SW to activate,
 * and the moment it takes control we RELOAD immediately — so the old page is
 * gone before it can request a purged chunk. Net effect: a deploy applies on
 * the next load (or within ~60s for an open tab) with no manual step.
 *
 * Caveat: this can only help a build that already contains this code. A tab
 * still running a PRE-fix build won't auto-recover — that one needs one hard
 * refresh (Ctrl+Shift+R) — but every deploy AFTER this ships is seamless.
 */
export default function SWUpdater() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let reloaded = false;
    const onControllerChange = () => {
      // Fired when the newly-activated SW takes control → jump onto it.
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Ask a WAITING worker to activate — but only when a controller already
    // exists (i.e. this is an update, not the very first install, which would
    // otherwise reload the page on first visit for no reason).
    const activateWaiting = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    };

    let registration: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      registration = reg;
      activateWaiting(reg); // a new build may already be waiting on load
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed") activateWaiting(reg);
        });
      });
    }).catch(() => {});

    // Poll for a fresh deploy so a long-open tab (or one parked on the login
    // gate) picks it up without a manual navigation.
    const check = () => registration?.update().catch(() => {});
    const interval = setInterval(check, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, []);

  return null;
}
