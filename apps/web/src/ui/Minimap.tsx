"use client";

/**
 * City minimap: a round, collapsible corner view that follows you, and a full
 * map you can pan, zoom and filter by category. NPCs stand, full body, on
 * the spot where they spawn.
 *
 * The picture comes from MinimapHost, which draws it from the live tilemap;
 * markers are read off the scene every animation frame, so wandering NPCs and
 * other players move on the map as they move in the city.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getMinimapHost, MINIMAP_READY_EVENT, MINIMAP_SCALE,
  type MinimapHost, type MinimapPoint,
} from "@/game/minimap/MinimapHost";
import { CATEGORY_META, CATEGORY_ORDER, type MinimapCategory } from "@/game/minimap/categories";

const PIXEL_FONT = '"Press Start 2P", monospace';
const PANEL_BG = "rgba(8,10,22,0.72)";
const PANEL_BORDER = "1px solid rgba(153,69,255,0.28)";
const WATER = "#0b3a5c";
const COLLAPSED_KEY = "solcity:minimap-collapsed";

function emitGame(name: string, ...args: unknown[]) {
  (globalThis as { __solCityGameEvents?: { emit: (n: string, ...a: unknown[]) => void } })
    .__solCityGameEvents?.emit(name, ...args);
}

function useMinimapHost(): MinimapHost | null {
  const [host, setHost] = useState<MinimapHost | null>(null);
  useEffect(() => {
    const read = () => setHost(getMinimapHost());
    read();
    window.addEventListener(MINIMAP_READY_EVENT, read);
    return () => window.removeEventListener(MINIMAP_READY_EVENT, read);
  }, []);
  return host;
}

// ── Markers ────────────────────────────────────────────────────────────────

/** One shape per category, so the map still reads for colour-blind players. */
function drawMarker(ctx: CanvasRenderingContext2D, cat: MinimapCategory, x: number, y: number, r: number) {
  const color = CATEGORY_META[cat].color;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  switch (cat) {
    case "defi":
      ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 1.1, 0); ctx.lineTo(0, r * 1.25); ctx.lineTo(-r * 1.1, 0);
      ctx.closePath();
      break;
    case "games": {
      const s = r * 1.3;
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? s : s * 0.48;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    }
    case "landmark":
      ctx.rect(-r * 0.95, -r * 0.95, r * 1.9, r * 1.9);
      break;
    case "players":
      ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
      break;
    default:
      ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.35);
  ctx.strokeStyle = "rgba(4,6,14,0.9)";
  ctx.stroke();
  if (cat === "guide" && r >= 5) {
    ctx.fillStyle = "#1a1405";
    ctx.font = `bold ${Math.round(r * 1.4)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 0, r * 0.08);
  }
  ctx.restore();
}

/**
 * An NPC standing on its spawn spot: the full sprite, feet on the point, on a
 * ground ring in its category colour with a matching glow, so the category
 * reads without covering the character. `h` is the drawn body height.
 * Returns the body centre, for hit-testing.
 */
function drawPin(ctx: CanvasRenderingContext2D, point: MinimapPoint, x: number, y: number, h: number, highlight = false) {
  if (!point.portrait) {
    drawMarker(ctx, point.category, x, y, Math.max(3, h * 0.2));
    return { x, y };
  }
  const color = CATEGORY_META[point.category].color;
  const img = point.portrait;
  const w = (img.width / img.height) * h;
  ctx.save();
  // Ground ring
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(w * 0.62, h * 0.32), h * 0.13, 0, 0, Math.PI * 2);
  ctx.fillStyle = color + "55";
  ctx.fill();
  ctx.lineWidth = highlight ? 2.5 : 1.5;
  ctx.strokeStyle = highlight ? "#ffffff" : color;
  ctx.stroke();
  // Body, with a tight dark outline and a category glow so it pops off the map
  ctx.imageSmoothingEnabled = false;
  ctx.shadowColor = highlight ? "#ffffff" : color;
  ctx.shadowBlur = highlight ? 8 : 5;
  ctx.drawImage(img, x - w / 2, y - h + h * 0.04, w, h);
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 1.5;
  ctx.drawImage(img, x - w / 2, y - h + h * 0.04, w, h);
  ctx.restore();
  return { x, y: y - h / 2 };
}

/** You: a teal disc with a pulsing ring, always drawn last. */
function drawYou(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  const pulse = (t % 1400) / 1400;
  ctx.beginPath();
  ctx.arc(x, y, r + pulse * r * 2.2, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(20,241,149,${0.7 * (1 - pulse)})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#14F195";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

function Swatch({ cat, size = 14 }: { cat: MinimapCategory; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    ctx.scale(dpr, dpr);
    if (cat === "landmark" || cat === "players") {
      drawMarker(ctx, cat, size / 2, size / 2, size * 0.33);
    } else {
      // NPC categories are portrait pins on the map, so the legend shows the ring.
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = "#101426";
      ctx.fill();
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = CATEGORY_META[cat].color;
      ctx.stroke();
    }
  }, [cat, size]);
  return <canvas ref={ref} style={{ width: size, height: size, flexShrink: 0, display: "block" }} />;
}

// ── View math ───────────────────────────────────────────────────────────────

interface View { cx: number; cy: number; zoom: number }

/** Draw the map picture for a view: world (cx, cy) at the canvas centre, `zoom` CSS px per world px. */
function drawBase(ctx: CanvasRenderingContext2D, host: MinimapHost, v: View, w: number, h: number) {
  ctx.fillStyle = WATER;
  ctx.fillRect(0, 0, w, h);
  const sx = (v.cx - w / 2 / v.zoom) * MINIMAP_SCALE;
  const sy = (v.cy - h / 2 / v.zoom) * MINIMAP_SCALE;
  const sw = (w / v.zoom) * MINIMAP_SCALE;
  const sh = (h / v.zoom) * MINIMAP_SCALE;
  ctx.imageSmoothingEnabled = v.zoom * (1 / MINIMAP_SCALE) < 1.5;
  ctx.drawImage(host.image, sx, sy, sw, sh, 0, 0, w, h);
}

function toScreen(v: View, w: number, h: number, x: number, y: number) {
  return { x: (x - v.cx) * v.zoom + w / 2, y: (y - v.cy) * v.zoom + h / 2 };
}

function useCanvasSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ── Compact corner map ──────────────────────────────────────────────────────

export default function Minimap({ compact }: { compact?: "mobile" | "desktop" }) {
  const host = useMinimapHost();
  const [open, setOpen] = useState(false);

  const setOpenAndNotify = useCallback((v: boolean) => {
    setOpen(v);
    emitGame("minimap:open", v);
  }, []);

  // M toggles the full map, unless the player is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setOpenAndNotify(!open);
      } else if (e.key === "Escape" && open) {
        setOpenAndNotify(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpenAndNotify]);

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch { /* storage blocked */ }
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSED_KEY, v ? "0" : "1"); } catch { /* storage blocked */ }
      return !v;
    });
  }, []);

  if (!host) return null;
  const mobile = compact === "mobile";

  return (
    <>
      {collapsed ? (
        <CollapsedMap mobile={mobile} onExpand={toggleCollapsed} onOpen={() => setOpenAndNotify(true)} />
      ) : (
        <CompactMap host={host} mobile={mobile} onOpen={() => setOpenAndNotify(true)} onCollapse={toggleCollapsed} />
      )}
      {/* Portalled: the compact map lives inside the HUD's stacking context,
          which would otherwise keep the modal under the touch controls. */}
      {open && createPortal(<FullMap host={host} onClose={() => setOpenAndNotify(false)} />, document.body)}
    </>
  );
}

function CompactMap({ host, mobile, onOpen, onCollapse }: {
  host: MinimapHost; mobile: boolean; onOpen: () => void; onCollapse: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const D = mobile ? 84 : 176;
  // World px shown across the diameter: about 46 tiles on desktop, 26 on a phone.
  const zoom = D / (mobile ? 620 : 1100);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = D * dpr;
    c.height = D * dpr;
    const R = D / 2;
    let raf = 0;
    const loop = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const snap = host.snapshot();
      const me = snap.player ?? { x: host.worldW / 2, y: host.worldH / 2 };
      const v: View = { cx: me.x, cy: me.y, zoom };
      ctx.clearRect(0, 0, D, D);
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R, 0, Math.PI * 2);
      ctx.clip();
      drawBase(ctx, host, v, D, D);
      const inside = (p: { x: number; y: number }, pad: number) => Math.hypot(p.x - R, p.y - R) < R - pad;
      for (const l of host.landmarks) {
        const p = toScreen(v, D, D, l.x, l.y);
        if (inside(p, 4)) drawMarker(ctx, "landmark", p.x, p.y, mobile ? 2.4 : 3);
      }
      const bodyH = mobile ? 13 : 22;
      // South-most last, so nearer pins overlap the ones behind them.
      for (const n of [...snap.npcs].sort((a, b) => a.y - b.y)) {
        const p = toScreen(v, D, D, n.x, n.y);
        if (inside(p, bodyH * 0.6)) drawPin(ctx, n, p.x, p.y, bodyH);
      }
      for (const o of snap.players) {
        const p = toScreen(v, D, D, o.x, o.y);
        if (inside(p, 3)) drawMarker(ctx, "players", p.x, p.y, mobile ? 2.6 : 3.2);
      }
      drawYou(ctx, R, R, mobile ? 3.5 : 4.5, t);
      // Vignette toward the rim.
      const g = ctx.createRadialGradient(R, R, R * 0.62, R, R, R);
      g.addColorStop(0, "rgba(4,6,14,0)");
      g.addColorStop(1, "rgba(4,6,14,0.6)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, D, D);
      ctx.restore();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [host, mobile, D, zoom]);

  const chip = mobile ? 20 : 26;
  return (
    <div style={{ position: "relative", width: D, height: D, flexShrink: 0 }}>
      <button
        onClick={onOpen}
        aria-label="Open city map"
        title="City map [M]"
        style={{
          position: "absolute", inset: 0, padding: 0, cursor: "pointer",
          borderRadius: "50%", overflow: "hidden",
          border: "3px solid rgba(153,69,255,0.55)", background: PANEL_BG,
          boxShadow: "0 0 0 1px rgba(20,241,149,0.25), 0 6px 24px rgba(0,0,0,0.5)",
          WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </button>
      {/* Label on the rim, north. */}
      <span style={{
        position: "absolute", left: "50%", top: -2, transform: "translateX(-50%)", pointerEvents: "none",
        fontFamily: PIXEL_FONT, fontSize: mobile ? 5 : 6, color: "#e2e8f0", whiteSpace: "nowrap",
        background: "rgba(8,10,22,0.92)", border: PANEL_BORDER, borderRadius: 6, padding: "3px 6px",
      }}>
        MAP{mobile ? "" : " [M]"}
      </span>
      <button
        onClick={onCollapse}
        aria-label="Hide minimap"
        title="Hide minimap"
        style={{ ...rimBtn(chip), left: mobile ? -2 : 4, bottom: mobile ? -2 : 4 }}
      >
        −
      </button>
      <button
        onClick={onOpen}
        aria-label="Open full map"
        title="Full map [M]"
        style={{ ...rimBtn(chip), right: mobile ? -2 : 4, bottom: mobile ? -2 : 4, fontSize: mobile ? 11 : 13 }}
      >
        ⤢
      </button>
    </div>
  );
}

/** The minimap folded away: one round button that brings it back. */
function CollapsedMap({ mobile, onExpand, onOpen }: { mobile: boolean; onExpand: () => void; onOpen: () => void }) {
  const size = mobile ? 36 : 40;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <button
        onClick={onOpen}
        aria-label="Open full map"
        title="Full map [M]"
        style={{ ...rimBtn(size), position: "static", fontFamily: PIXEL_FONT, fontSize: 7 }}
      >
        MAP
      </button>
      <button
        onClick={onExpand}
        aria-label="Show minimap"
        title="Show minimap"
        style={{ ...rimBtn(size * 0.7), position: "static", fontSize: 14 }}
      >
        +
      </button>
    </div>
  );
}

function rimBtn(size: number): React.CSSProperties {
  return {
    position: "absolute", width: size, height: size, borderRadius: "50%", padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(8,10,22,0.92)", border: "1px solid rgba(153,69,255,0.55)",
    color: "#e2e8f0", fontSize: Math.round(size * 0.6), lineHeight: 1, cursor: "pointer",
    boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
    WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
  };
}

// ── Full map ────────────────────────────────────────────────────────────────

const MIN_ZOOM_FACTOR = 1;   // × fit
const MAX_ZOOM = 1.6;        // CSS px per world px

function FullMap({ host, onClose }: { host: MinimapHost; onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w, h } = useCanvasSize(wrapRef);
  const [narrow, setNarrow] = useState(false);
  const [enabled, setEnabled] = useState<Set<MinimapCategory>>(() => new Set(CATEGORY_ORDER));
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ point: MinimapPoint; x: number; y: number } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [counts, setCounts] = useState<Record<MinimapCategory, number>>(
    () => Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<MinimapCategory, number>,
  );

  const viewRef = useRef<View | null>(null);
  const targetRef = useRef<View | null>(null);
  const pointsRef = useRef<MinimapPoint[]>([]);
  /** Where each NPC pin head was drawn last frame, for hit-testing. */
  const headsRef = useRef(new Map<string, { x: number; y: number }>());
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px), (max-height: 520px)");
    const read = () => setNarrow(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  const fitZoom = useCallback(() => (w && h ? Math.min(w / host.worldW, h / host.worldH) : 0.2), [w, h, host]);
  const clampView = useCallback((v: View): View => {
    const zoom = Math.min(MAX_ZOOM, Math.max(fitZoom() * MIN_ZOOM_FACTOR, v.zoom));
    const halfW = w / 2 / zoom;
    const halfH = h / 2 / zoom;
    const cx = halfW * 2 >= host.worldW ? host.worldW / 2 : Math.min(host.worldW - halfW, Math.max(halfW, v.cx));
    const cy = halfH * 2 >= host.worldH ? host.worldH / 2 : Math.min(host.worldH - halfH, Math.max(halfH, v.cy));
    return { cx, cy, zoom };
  }, [fitZoom, w, h, host]);

  // First layout: centre on the player, zoomed in a little past "whole map".
  useEffect(() => {
    if (!w || !h || viewRef.current) return;
    const me = host.snapshot().player ?? { x: host.worldW / 2, y: host.worldH / 2 };
    const v = clampView({ cx: me.x, cy: me.y, zoom: fitZoom() * 1.8 });
    viewRef.current = v;
    targetRef.current = v;
  }, [w, h, host, clampView, fitZoom]);

  const focus = useCallback((p: { x: number; y: number }, zoom?: number) => {
    const cur = targetRef.current ?? viewRef.current;
    if (!cur) return;
    targetRef.current = clampView({ cx: p.x, cy: p.y, zoom: zoom ?? Math.max(cur.zoom, fitZoom() * 3) });
  }, [clampView, fitZoom]);

  // Render loop.
  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr;
    c.height = h * dpr;
    let raf = 0;
    let lastCounts = "";
    const loop = (t: number) => {
      const target = targetRef.current;
      let v = viewRef.current;
      if (!v || !target) { raf = requestAnimationFrame(loop); return; }
      // Ease toward the target so "go to" and wheel zoom glide.
      v = {
        cx: v.cx + (target.cx - v.cx) * 0.22,
        cy: v.cy + (target.cy - v.cy) * 0.22,
        zoom: v.zoom + (target.zoom - v.zoom) * 0.22,
      };
      viewRef.current = v;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBase(ctx, host, v, w, h);

      const snap = host.snapshot();
      const all: MinimapPoint[] = [...host.landmarks, ...snap.npcs, ...snap.players];
      pointsRef.current = all;
      const nextCounts = CATEGORY_ORDER.map((cat) => all.filter((p) => p.category === cat).length).join(",");
      if (nextCounts !== lastCounts) {
        lastCounts = nextCounts;
        const arr = nextCounts.split(",").map(Number);
        setCounts(Object.fromEntries(CATEGORY_ORDER.map((cat, i) => [cat, arr[i]])) as Record<MinimapCategory, number>);
      }

      const on = enabledRef.current;
      const r = Math.max(5, Math.min(9, v.zoom * 22));
      const showNames = v.zoom >= fitZoom() * 2.4;

      // Place labels first so markers sit on top of them.
      if (on.has("landmark")) {
        for (const l of host.landmarks) {
          const p = toScreen(v, w, h, l.x, l.y);
          drawTag(ctx, l.name, p.x, p.y, CATEGORY_META.landmark.color, v.zoom >= fitZoom() * 1.3);
        }
      }
      const bodyH = Math.max(26, Math.min(58, v.zoom * 115));
      const heads = new Map<string, { x: number; y: number }>();
      for (const n of [...snap.npcs].sort((a, b) => a.y - b.y)) {
        if (!on.has(n.category)) continue;
        const p = toScreen(v, w, h, n.x, n.y);
        if (p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) continue;
        heads.set(n.id, drawPin(ctx, n, p.x, p.y, bodyH, selectedRef.current === n.id));
        if (showNames || selectedRef.current === n.id) drawName(ctx, n.name, p.x, p.y + 5);
      }
      headsRef.current = heads;
      for (const n of snap.players) {
        if (!on.has(n.category)) continue;
        const p = toScreen(v, w, h, n.x, n.y);
        drawMarker(ctx, n.category, p.x, p.y, r * 0.8);
        if (showNames || selectedRef.current === n.id) drawName(ctx, n.name, p.x, p.y + r + 3);
      }
      const sel = selectedRef.current && all.find((p) => p.id === selectedRef.current && !p.portrait);
      if (sel) {
        const p = toScreen(v, w, h, sel.x, sel.y);
        const pulse = (t % 1000) / 1000;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6 + pulse * 8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.9 - pulse * 0.7})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (snap.player) {
        const p = toScreen(v, w, h, snap.player.x, snap.player.y);
        drawYou(ctx, p.x, p.y, Math.max(5, r * 0.8), t);
        drawName(ctx, "YOU", p.x, p.y + r + 4, "#14F195");
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [host, w, h, fitZoom]);

  // Pan (drag), pinch and wheel zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragMoved = useRef(false);
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);

  const hitTest = useCallback((sx: number, sy: number): MinimapPoint | null => {
    const v = viewRef.current;
    if (!v) return null;
    const r = Math.max(5, Math.min(9, v.zoom * 22)) + 6;
    let best: { p: MinimapPoint; d: number } | null = null;
    for (const p of pointsRef.current) {
      if (!enabledRef.current.has(p.category)) continue;
      const head = headsRef.current.get(p.id);
      const s = head ?? toScreen(v, w, h, p.x, p.y);
      const reach = head ? Math.max(26, Math.min(58, v.zoom * 115)) * 0.55 + 4 : r;
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d <= reach && (!best || d < best.d)) best = { p, d };
    }
    return best?.p ?? null;
  }, [w, h]);

  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    dragMoved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: targetRef.current?.zoom ?? 1 };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const pos = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === "mouse") {
        const hit = hitTest(pos.x, pos.y);
        setHover(hit ? { point: hit, x: pos.x, y: pos.y } : null);
      }
      return;
    }
    pointers.current.set(e.pointerId, pos);
    const t = targetRef.current;
    const v = viewRef.current;
    if (!t || !v) return;
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const zoom = pinchStart.current.zoom * (dist / pinchStart.current.dist);
      const next = clampView({ ...t, zoom });
      targetRef.current = next;
      viewRef.current = next;
      dragMoved.current = true;
      return;
    }
    const dx = pos.x - prev.x;
    const dy = pos.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved.current = true;
    const next = clampView({ cx: t.cx - dx / t.zoom, cy: t.cy - dy / t.zoom, zoom: t.zoom });
    targetRef.current = next;
    viewRef.current = { ...next, zoom: v.zoom };
    setHover(null);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const pos = local(e);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (!dragMoved.current) {
      const hit = hitTest(pos.x, pos.y);
      setSelected(hit?.id ?? null);
      setHover(hit ? { point: hit, x: pos.x, y: pos.y } : null);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    setHover(null);
    const t = targetRef.current;
    if (!t) return;
    const pos = local(e);
    const zoom = Math.min(MAX_ZOOM, Math.max(fitZoom(), t.zoom * Math.exp(-e.deltaY * 0.0015)));
    // Keep the world point under the cursor fixed while zooming.
    const wx = t.cx + (pos.x - w / 2) / t.zoom;
    const wy = t.cy + (pos.y - h / 2) / t.zoom;
    targetRef.current = clampView({ cx: wx - (pos.x - w / 2) / zoom, cy: wy - (pos.y - h / 2) / zoom, zoom });
  };

  const zoomBy = (f: number) => {
    const t = targetRef.current;
    if (t) targetRef.current = clampView({ ...t, zoom: t.zoom * f });
  };

  const goTo = (p: MinimapPoint) => {
    setSelected(p.id);
    setHover(null);
    focus(p);
    if (narrow) setListOpen(false);
  };

  const toggle = (cat: MinimapCategory) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const places = useMemo(() => {
    const snap = host.snapshot();
    const byCat = new Map<MinimapCategory, MinimapPoint[]>();
    for (const p of [...snap.npcs, ...host.landmarks, ...snap.players]) {
      const list = byCat.get(p.category) ?? [];
      list.push(p);
      byCat.set(p.category, list);
    }
    for (const list of byCat.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return byCat;
    // Recomputed when the list opens or filters change; positions come from
    // the live snapshot at click time via pointsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, listOpen, enabled, counts]);

  // The selected card tracks its marker as the view glides or the NPC walks.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!selected) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 60);
    return () => window.clearInterval(id);
  }, [selected]);
  const selectedPoint = selected ? pointsRef.current.find((p) => p.id === selected) ?? null : null;

  const legend = (
    <div style={{ display: "flex", flexDirection: narrow ? "row" : "column", gap: 6, flexWrap: narrow ? "nowrap" : "wrap", overflowX: narrow ? "auto" : "visible" }}>
      {CATEGORY_ORDER.map((cat) => {
        const on = enabled.has(cat);
        return (
          <button
            key={cat}
            onClick={() => toggle(cat)}
            aria-pressed={on}
            style={{
              display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
              padding: narrow ? "6px 9px" : "7px 9px", borderRadius: 8, cursor: "pointer",
              background: on ? "rgba(255,255,255,0.06)" : "transparent",
              border: `1px solid ${on ? CATEGORY_META[cat].color + "88" : "rgba(255,255,255,0.1)"}`,
              opacity: on ? 1 : 0.45, textAlign: "left",
            }}
          >
            <Swatch cat={cat} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontFamily: PIXEL_FONT, fontSize: 7, color: "#e2e8f0", whiteSpace: "nowrap" }}>
                {CATEGORY_META[cat].label.toUpperCase()} <span style={{ color: "#64748b" }}>{counts[cat]}</span>
              </span>
              {!narrow && (
                <span style={{ fontSize: 10, color: "#8b93a7", marginTop: 3 }}>{CATEGORY_META[cat].hint}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );

  const placeList = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {CATEGORY_ORDER.filter((c) => enabled.has(c) && (places.get(c)?.length ?? 0) > 0).map((cat) => (
        <div key={cat}>
          <div style={{ fontFamily: PIXEL_FONT, fontSize: 7, color: CATEGORY_META[cat].color, marginBottom: 5 }}>
            {CATEGORY_META[cat].label.toUpperCase()}
          </div>
          {places.get(cat)!.map((p) => (
            <button
              key={p.id}
              onClick={() => goTo(p)}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "5px 6px", borderRadius: 6, cursor: "pointer", textAlign: "left",
                background: selected === p.id ? "rgba(20,241,149,0.12)" : "transparent",
                border: "1px solid transparent",
              }}
            >
              {p.portrait ? <Portrait point={p} size={34} /> : <Swatch cat={cat} size={12} />}
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                {p.role && <span style={{ display: "block", fontSize: 10, color: "#8b93a7" }}>{p.role}</span>}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  const card = (hover && hover.point.id !== selected ? hover : null) ?? (selectedPoint && viewRef.current
    ? { point: selectedPoint, ...toScreen(viewRef.current, w, h, selectedPoint.x, selectedPoint.y) }
    : null);

  return (
    <div
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(2,4,12,0.7)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: narrow ? "max(env(safe-area-inset-top, 0px), 8px) 8px 8px" : 20,
      }}
    >
      <div style={{
        width: "min(1180px, 100%)", height: narrow ? "100%" : "min(820px, 100%)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        background: "rgba(8,10,22,0.95)", border: "1px solid rgba(153,69,255,0.35)",
        borderRadius: 14, boxShadow: "0 20px 70px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: narrow ? "8px 10px" : "12px 16px", borderBottom: "1px solid rgba(153,69,255,0.18)" }}>
          <span style={{ fontFamily: PIXEL_FONT, fontSize: narrow ? 9 : 11, color: "#14F195", letterSpacing: 1 }}>SOLANA CITY MAP</span>
          {!narrow && <span style={{ fontSize: 11, color: "#64748b" }}>Drag to move · scroll to zoom · click a marker</span>}
          <div style={{ flex: 1 }} />
          {narrow && (
            <button onClick={() => setListOpen((v) => !v)} style={hdrBtn(listOpen)}>{listOpen ? "MAP" : "LIST"}</button>
          )}
          <button onClick={onClose} aria-label="Close map" style={{ ...hdrBtn(false), fontSize: 14, padding: "4px 10px", fontFamily: "system-ui" }}>×</button>
        </div>

        {narrow && <div style={{ padding: "8px 10px 0" }}>{legend}</div>}

        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 0 }}>
          {!narrow && (
            <aside style={{ width: 250, flexShrink: 0, borderRight: "1px solid rgba(153,69,255,0.18)", padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
              {legend}
              <div style={{ height: 1, background: "rgba(153,69,255,0.18)" }} />
              {placeList}
            </aside>
          )}

          <div ref={wrapRef} style={{ position: "relative", flex: 1, minWidth: 0, margin: narrow ? 8 : 0, borderRadius: narrow ? 10 : 0, overflow: "hidden" }}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setHover(null)}
              onWheel={onWheel}
              style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: hover ? "pointer" : "grab" }}
            />

            {card && (
              <div style={{
                position: "absolute", pointerEvents: "none",
                left: Math.min(Math.max(card.x + 14, 8), Math.max(8, w - 220)),
                top: Math.min(Math.max(card.y - 20, 8), Math.max(8, h - 80)),
                maxWidth: 210, padding: "8px 10px", borderRadius: 8,
                background: "rgba(8,10,22,0.95)", border: `1px solid ${CATEGORY_META[card.point.category].color}88`,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {card.point.portrait ? <Portrait point={card.point} size={40} /> : <Swatch cat={card.point.category} size={12} />}
                  <span style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 700 }}>{card.point.name}</span>
                </div>
                <div style={{ fontSize: 11, color: "#8b93a7", marginTop: 3 }}>
                  {card.point.role ? `${card.point.role} · ` : ""}{CATEGORY_META[card.point.category].label}
                </div>
              </div>
            )}

            {/* Map controls */}
            <div style={{ position: "absolute", right: 10, bottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={() => { const me = host.snapshot().player; if (me) { setSelected(null); focus(me); } }} style={ctrlBtn} title="Center on me" aria-label="Center on me">◎</button>
              <button onClick={() => zoomBy(1.4)} style={ctrlBtn} aria-label="Zoom in">+</button>
              <button onClick={() => zoomBy(1 / 1.4)} style={ctrlBtn} aria-label="Zoom out">−</button>
            </div>

            {narrow && listOpen && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(8,10,22,0.96)", overflowY: "auto", padding: 12 }}>
                {placeList}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** An NPC's portrait in a ring of its category colour, for lists and cards. */
function Portrait({ point, size }: { point: MinimapPoint; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !point.portrait) return;
    c.width = point.portrait.width;
    c.height = point.portrait.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(point.portrait, 0, 0);
  }, [point]);
  return (
    <span style={{
      width: size, height: size, borderRadius: 8, overflow: "hidden", flexShrink: 0,
      background: "#101426", border: `2px solid ${CATEGORY_META[point.category].color}`,
      display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 2, boxSizing: "border-box",
    }}>
      <canvas ref={ref} style={{ maxWidth: "100%", maxHeight: "100%", display: "block", imageRendering: "pixelated" }} />
    </span>
  );
}

function hdrBtn(active: boolean): React.CSSProperties {
  return {
    fontFamily: PIXEL_FONT, fontSize: 7, color: active ? "#0a0a14" : "#cbd5e1",
    background: active ? "#14F195" : "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6,
    padding: "6px 9px", cursor: "pointer",
  };
}

const ctrlBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 8, cursor: "pointer",
  background: "rgba(8,10,22,0.9)", border: "1px solid rgba(153,69,255,0.35)",
  color: "#e2e8f0", fontSize: 17, lineHeight: 1,
  display: "flex", alignItems: "center", justifyContent: "center",
};

function drawName(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = "#f1f5f9") {
  ctx.save();
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(4,6,14,0.9)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A place label: a small pill with the name, or just a marker when zoomed far out. */
function drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, withText: boolean) {
  if (!withText) {
    drawMarker(ctx, "landmark", x, y, 4);
    return;
  }
  ctx.save();
  ctx.font = "bold 10px system-ui, sans-serif";
  const tw = ctx.measureText(text).width;
  const pw = tw + 12;
  const ph = 17;
  ctx.fillStyle = "rgba(8,10,22,0.85)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - pw / 2, y - ph / 2, pw, ph, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f5f3ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}
