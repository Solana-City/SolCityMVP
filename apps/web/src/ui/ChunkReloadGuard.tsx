"use client";

import { useEffect } from "react";

const RELOAD_STAMP_KEY = "solcity:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 30_000;

function isChunkError(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return (
    value.includes("ChunkLoadError") ||
    /Loading (CSS )?chunk .* failed/i.test(value)
  );
}

/**
 * After a deploy, a tab running the previous build (or stale HTML served
 * from the service worker on a slow connection) can lazy-load chunks whose
 * hashed filenames no longer exist on the server. Next.js surfaces this as
 * a ChunkLoadError; a hard reload fetches fresh HTML with the current chunk
 * graph. A cooldown stamp in sessionStorage prevents a reload loop if the
 * build is genuinely broken.
 */
export function ChunkReloadGuard() {
  useEffect(() => {
    const reloadOnce = () => {
      const last = Number(sessionStorage.getItem(RELOAD_STAMP_KEY) ?? 0);
      if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
      sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
      window.location.reload();
    };

    const onError = (event: ErrorEvent) => {
      if (isChunkError(event.message) || isChunkError(event.error?.name)) {
        reloadOnce();
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { name?: string; message?: string } | undefined;
      if (isChunkError(reason?.name) || isChunkError(reason?.message)) {
        reloadOnce();
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
