import { NextRequest, NextResponse } from "next/server";

/**
 * Pegana peg risk, proxied for the Raffx NPC at the ST Brasil stand.
 *
 * Pegana compares what a stablecoin or LST is worth (its anchor: NAV for an
 * LST, reserves for a stablecoin) against what it trades for, and publishes
 * the gap as one of PEGGED / DRIFT / DEPEG / CRITICAL / BLACK_SWAN, or
 * UNKNOWN while a source is cold or stale. Their REST API is free and takes
 * no key, so the only reason to go through our own route is CORS, a timeout
 * the browser can't set, and one shared cache for every player in the city.
 *
 *   GET /api/peg-risk            → the watch list, trimmed
 *   GET /api/peg-risk?asset=SYM  → one asset's current state
 */
export const revalidate = 60;

const UPSTREAM = "https://api.pegana.xyz/v1";
const UA = { "User-Agent": "SolanaCity/1.0" };
const TIMEOUT_MS = 8_000;

/** Symbols are short tickers (jitoSOL, USDC, mSOL). Anything else is a typo. */
const SYMBOL = /^[A-Za-z0-9._-]{1,16}$/;

export interface PegAsset {
  symbol: string;
  name: string;
  /** "lst" or "stable" — what the peg is measured against. */
  class: string;
  pegTarget: string;
  state: string;
  /** Gap from the peg as a fraction (0.0042 = 42 bps), or null when unknown. */
  discount: number | null;
  riskScore: number | null;
  intrinsicUsd: number | null;
  marketUsd: number | null;
  updatedAt: string | null;
  /** The reading is old enough that Pegana itself will not stand behind it. */
  stale: boolean;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function isStale(updatedAt: string | null, reason?: string): boolean {
  if (reason === "stale_source") return true;
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  // An hour: their severe events publish in real time, so an older reading is
  // history rather than a quote.
  return !Number.isFinite(t) || Date.now() - t > 60 * 60 * 1000;
}

export async function GET(request: NextRequest) {
  const asset = request.nextUrl.searchParams.get("asset");

  try {
    if (asset) {
      if (!SYMBOL.test(asset)) {
        return NextResponse.json({ ok: false, error: "bad asset" }, { status: 400 });
      }
      const res = await fetch(`${UPSTREAM}/assets/${encodeURIComponent(asset)}/state`, {
        next: { revalidate }, headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 404) {
        return NextResponse.json({ ok: false, error: "not watched" }, { status: 404 });
      }
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const d = await res.json();
      const updatedAt = d.updated_at ?? null;
      return NextResponse.json({
        ok: true,
        state: {
          symbol: d.asset ?? asset,
          state: d.state ?? "UNKNOWN",
          discount: num(d.discount),
          intrinsicUsd: num(d.intrinsic_usd),
          marketUsd: num(d.market_usd),
          confidence: d.confidence ?? null,
          updatedAt,
          stale: d.stale === true || isStale(updatedAt, d.state_reason),
        },
      });
    }

    const res = await fetch(`${UPSTREAM}/assets`, {
      next: { revalidate }, headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    const raw: Record<string, unknown>[] = Array.isArray(data?.data) ? data.data : [];

    const assets: PegAsset[] = raw
      .filter((a) => typeof a.symbol === "string")
      .map((a) => ({
        symbol: a.symbol as string,
        name: (a.name as string) ?? (a.symbol as string),
        class: (a.class as string) ?? "",
        pegTarget: (a.peg_target as string) ?? "",
        state: (a.state as string) ?? "UNKNOWN",
        discount: num(a.discount),
        riskScore: num(a.risk_score),
        intrinsicUsd: num(a.intrinsic_usd),
        marketUsd: num(a.market_usd),
        updatedAt: (a.updated_at as string) ?? null,
        stale: isStale((a.updated_at as string) ?? null, a.state_reason as string),
      }));

    return NextResponse.json({ ok: true, assets, generatedAt: data?.generated_at ?? null });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unreachable" },
      { status: 502 },
    );
  }
}
