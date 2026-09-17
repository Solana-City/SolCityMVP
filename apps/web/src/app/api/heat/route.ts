import { NextRequest, NextResponse } from "next/server";
import { hgetall, hset, storeMode } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Walking heatmap: a count per map cell, written in batches by the client.
 *
 * No wallet is attached. The question is which parts of the city are alive,
 * and answering it per person would be both heavier and more intrusive than it
 * needs to be.
 *
 * POST { cells: { "3,7": 12, ... } }  (public, clamped)
 * GET  -> { cells }                   (public; it is a picture of the map)
 */
const KEY = "heat:cells";
const CELL_RE = /^\d{1,3},\d{1,3}$/;
/** One batch is half a minute of one player; anything larger is not real. */
const MAX_PER_CELL = 60;
const MAX_CELLS = 200;

export async function GET() {
  if (storeMode() === "off") return NextResponse.json({ cells: {} });
  const raw = await hgetall(KEY).catch(() => ({} as Record<string, string>));
  const cells: Record<string, number> = {};
  for (const [cell, value] of Object.entries(raw)) cells[cell] = Number(value) || 0;
  return NextResponse.json({ cells }, { headers: { "Cache-Control": "public, max-age=60" } });
}

export async function POST(req: NextRequest) {
  if (storeMode() === "off") return NextResponse.json({ ok: false }, { status: 503 });
  const body = await req.json().catch(() => null);
  const cells = (body as { cells?: Record<string, unknown> } | null)?.cells;
  if (!cells || typeof cells !== "object") return NextResponse.json({ ok: false }, { status: 400 });

  // Read once, add, write once: a batch is a handful of cells and this keeps
  // it to two round trips rather than one per cell.
  const current = await hgetall(KEY).catch(() => ({} as Record<string, string>));
  let written = 0;
  for (const [cell, value] of Object.entries(cells).slice(0, MAX_CELLS)) {
    if (!CELL_RE.test(cell)) continue;
    const add = Math.max(0, Math.min(MAX_PER_CELL, Math.round(Number(value) || 0)));
    if (add === 0) continue;
    const next = (Number(current[cell]) || 0) + add;
    await hset(KEY, cell, String(next));
    written++;
  }
  return NextResponse.json({ ok: true, written });
}
