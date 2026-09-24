import { NextRequest, NextResponse } from "next/server";

/**
 * SolSentry token risk, proxied for the Crash NPC at the ST Brasil stand.
 *
 * SolSentry scores the OPERATOR behind a mint (has this wallet rugged before?)
 * on top of the usual contract checks, and records the call before the outcome
 * so it can be audited later. `/v1/token/{mint}` is free and keyless; the paid
 * x402 endpoints are not used here, so a player never signs anything to get a
 * reading.
 *
 *   GET /api/token-scan?mint=<mint address>
 */
export const revalidate = 60;

const UPSTREAM = "https://api.solsentry.app/v1";
const UA = { "User-Agent": "SolanaCity/1.0" };
const TIMEOUT_MS = 12_000;

/** Base58, 32-44 chars: a Solana address, before we bother their API with it. */
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface TokenScan {
  mint: string;
  symbol: string | null;
  known: boolean;
  riskLevel: string;
  riskScore: number | null;
  summary: string | null;
  flags: string[];
  factors: { detail: string; severity: string; source: string | null }[];
  operator: { wallet: string | null; riskLevel: string | null; confirmedRugs: number | null };
  holders: { count: number | null; top10Pct: number | null };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get("mint")?.trim() ?? "";
  if (!MINT.test(mint)) {
    return NextResponse.json({ ok: false, error: "That is not a Solana address." }, { status: 400 });
  }

  try {
    const res = await fetch(`${UPSTREAM}/token/${mint}`, {
      next: { revalidate }, headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) {
      return NextResponse.json({ ok: false, error: "No mint at that address." }, { status: 404 });
    }
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const d = await res.json();

    const factors: TokenScan["factors"] = (Array.isArray(d.risk_factors) ? d.risk_factors : [])
      .filter((f: Record<string, unknown>) => typeof f?.detail === "string")
      // Worst first, and only a handful: the panel is a card, not a report.
      .sort((a: Record<string, string>, b: Record<string, string>) =>
        severityRank(b.severity) - severityRank(a.severity))
      .slice(0, 4)
      .map((f: Record<string, string>) => ({
        detail: f.detail,
        severity: f.severity ?? "UNKNOWN",
        source: f.source ?? null,
      }));

    const scan: TokenScan = {
      mint,
      symbol: typeof d.symbol === "string" ? d.symbol : null,
      known: d.known === true,
      factors,
      riskLevel: typeof d.risk_level === "string" ? d.risk_level : "UNKNOWN",
      riskScore: num(d.risk_score),
      summary: typeof d.summary === "string" ? d.summary : null,
      flags: (Array.isArray(d.flags) ? d.flags : []).filter((f: unknown) => typeof f === "string").slice(0, 6),
      operator: {
        wallet: d.operator?.wallet ?? d.dev_wallet ?? null,
        riskLevel: d.operator?.risk_level ?? null,
        confirmedRugs: num(d.operator?.confirmed_rugs),
      },
      holders: {
        count: num(d.holders?.holder_count),
        top10Pct: num(d.holders?.top10_pct),
      },
    };

    return NextResponse.json({ ok: true, scan });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unreachable" },
      { status: 502 },
    );
  }
}

function severityRank(severity: unknown): number {
  switch (severity) {
    case "CRITICAL": return 4;
    case "HIGH": return 3;
    case "MEDIUM": return 2;
    case "LOW": return 1;
    default: return 0;
  }
}
