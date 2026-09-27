"use client";

/**
 * The keys, written down.
 *
 * Every one of these already worked; nothing in the city ever said so. The
 * 2026-09-27 playtest put it plainly: "reactions have hotkeys but no one uses
 * them because they don't know the hotkeys". So the list exists, it has a
 * button next to the zoom control, K and ? open it, and the first desktop
 * session opens it once by itself.
 */
import { useEffect, useState } from "react";

const SEEN_KEY = "solcity:keys-seen";

interface Row { keys: string[]; what: string }

const ROWS: Row[] = [
  { keys: ["W", "A", "S", "D"], what: "Walk (arrow keys too)" },
  { keys: ["E"], what: "Talk to whoever is next to you" },
  { keys: ["Click"], what: "Talk to any citizen you can see" },
  { keys: ["1", "…", "6"], what: "React: gm, heart, fire, lol, hmm, GG" },
  { keys: ["Enter"], what: "Chat. Enter sends, Esc leaves it" },
  { keys: ["P"], what: "Your profile" },
  { keys: ["H"], what: "Hide the interface (for screenshots)" },
  { keys: ["Scroll"], what: "Zoom in and out" },
  { keys: ["K"], what: "This list" },
];

export default function KeysCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      style={{ background: "rgba(6,10,20,0.6)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(10,10,30,0.97)",
          border: "1px solid rgba(153,69,255,0.35)",
          borderRadius: 12,
          padding: 20,
          width: "min(92vw, 420px)",
          fontFamily: '"Press Start 2P", monospace',
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: 14 }}>
          <h3 style={{ fontSize: 10, color: "#B7E928", margin: 0 }}>KEYS</h3>
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto", background: "none", border: "none", color: "#555566",
              cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0,
            }}
            aria-label="Close"
          >×</button>
        </div>

        {ROWS.map((row) => (
          <div key={row.what} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ display: "flex", gap: 4, flexShrink: 0, width: 116 }}>
              {row.keys.map((k) => (
                <kbd
                  key={k}
                  style={{
                    fontFamily: "inherit", fontSize: 7, color: "#ccccdd",
                    background: "#12122a", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 4, padding: "5px 6px", minWidth: 10, textAlign: "center",
                  }}
                >{k}</kbd>
              ))}
            </span>
            <span style={{ fontSize: 7, color: "#8888aa", lineHeight: 1.7 }}>{row.what}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Opens the card on K or ?, and once on a player's first desktop session —
 * the list is no use to somebody who never learns it exists.
 */
export function useKeysCard(enabled: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "k" || e.key === "K" || e.key === "?") setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
      localStorage.setItem(SEEN_KEY, "1");
      // After the city has drawn, so it lands on the game rather than on a
      // loading screen.
      const t = setTimeout(() => setOpen(true), 4000);
      return () => clearTimeout(t);
    } catch { /* private mode: the card is still one key away */ }
  }, [enabled]);

  return [open, setOpen];
}
