"use client";

/**
 * Sol Mechs — Genesis pass sale.
 *
 * Reads supply and the prize pool straight from chain on every load. The pool
 * figure is the balance of a published address rather than a number this app
 * keeps, so what the page claims can be checked against the explorer.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { fetchSaleState, fetchPrizePoolLamports, fetchOwnedPasses, type SaleState } from "@/game/solmechs/pass/read";
import { mintPass, PER_WALLET_LIMIT } from "@/game/solmechs/pass/mint";
import { isPassConfigured, PRIZE_POOL_ADDRESS, CANDY_MACHINE_ADDRESS } from "@/game/solmechs/pass/config";
import { LAMPORTS_PER_SOL, PASS_PRICE_LAMPORTS, SUPPLY } from "@/game/solmechs/season/config";

const C = {
  ink: "#0b0616", panel: "#150c2b", line: "#33235c",
  text: "#f0ecfa", body: "#c9bfe4", dim: "#9d8fc4", faint: "#7a6ba3",
  teal: "#21dda0", bad: "#ff5468",
};

const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(2);

export default function PassSale() {
  const wallet = useWallet();
  const [sale, setSale] = useState<SaleState | null>(null);
  const [pool, setPool] = useState<number | null>(null);
  const [owned, setOwned] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);

  const configured = isPassConfigured();

  const refresh = useCallback(async () => {
    if (!configured) return;
    try {
      const [s, p] = await Promise.all([fetchSaleState(), fetchPrizePoolLamports()]);
      setSale(s);
      setPool(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the sale.");
    }
    if (wallet.publicKey) {
      try {
        setOwned((await fetchOwnedPasses(wallet.publicKey.toBase58())).length);
      } catch { /* ownership is a nice-to-have on this screen */ }
    } else {
      setOwned(null);
    }
  }, [configured, wallet.publicKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onMint = async () => {
    const adapter = wallet.wallet?.adapter;
    if (!adapter || !wallet.connected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await mintPass(adapter);
      setMinted(res.asset);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mint failed.");
    } finally {
      setBusy(false);
    }
  };

  const soldOut = sale !== null && sale.remaining <= 0;

  return (
    <main style={sx.page}>
      <div style={sx.card}>
        <img
          src="/assets/minigames/sol-mechs/ui/logo.png"
          alt="Sol Mechs"
          style={{ imageRendering: "pixelated", width: "min(280px, 70%)", height: "auto", display: "block", margin: "0 auto" }}
        />
        <h1 style={sx.h1}>Genesis Pass</h1>
        <p style={sx.lead}>
          Four mechs — Titan, Striker, Arclight and HeartCore — and entry to the
          Season 1 ranked ladder. {SUPPLY.TOTAL.toLocaleString()} exist;
          whatever goes unsold is burned.
        </p>

        {!configured ? (
          <div style={sx.notice}>
            The sale is not live yet. Run{" "}
            <code style={sx.code}>scripts/solmechs-pass-setup.ts</code> and set the
            NEXT_PUBLIC_SOLMECHS_* env vars.
          </div>
        ) : (
          <>
            <div style={sx.stats}>
              <Stat label="Price" value={`${sol(PASS_PRICE_LAMPORTS)} SOL`} />
              <Stat
                label="Remaining"
                value={sale ? `${sale.remaining} / ${sale.available}` : "…"}
              />
              <Stat
                label="Prize pool"
                value={pool === null ? "—" : `${sol(pool)} SOL`}
                sub={PRIZE_POOL_ADDRESS ? "on-chain, verifiable" : undefined}
              />
              <Stat label="Max per wallet" value={String(PER_WALLET_LIMIT)} />
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
              <WalletMultiButton />
            </div>

            {wallet.connected && (
              <>
                {owned !== null && (
                  <p style={sx.owned}>
                    You hold <strong style={{ color: C.teal }}>{owned}</strong>{" "}
                    {owned === 1 ? "pass" : "passes"}.
                  </p>
                )}
                <button
                  onClick={onMint}
                  disabled={busy || soldOut}
                  style={{ ...sx.mint, opacity: busy || soldOut ? 0.45 : 1 }}
                >
                  {busy ? "MINTING…" : soldOut ? "SOLD OUT" : `MINT — ${sol(PASS_PRICE_LAMPORTS)} SOL`}
                </button>
              </>
            )}

            {minted && (
              <p style={{ ...sx.notice, borderColor: C.teal, color: C.teal }}>
                Minted. Asset <code style={sx.code}>{minted}</code>
              </p>
            )}
            {error && <p style={{ ...sx.notice, borderColor: C.bad, color: C.bad }}>{error}</p>}

            <p style={sx.footer}>
              Devnet. Candy machine{" "}
              <code style={sx.code}>{CANDY_MACHINE_ADDRESS || "—"}</code>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={sx.stat}>
      <div style={sx.statLabel}>{label}</div>
      <div style={sx.statValue}>{value}</div>
      {sub && <div style={sx.statSub}>{sub}</div>}
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", background: C.ink, display: "flex",
    alignItems: "center", justifyContent: "center", padding: 20,
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", color: C.body,
  },
  card: {
    width: "min(680px, 100%)", background: C.panel,
    border: `2px solid ${C.line}`, borderRadius: 12, padding: "32px 28px",
    boxShadow: "0 0 0 1px rgba(33,221,160,.2), 0 18px 60px rgba(0,0,0,.7)",
  },
  h1: { margin: "18px 0 8px", fontSize: 30, color: C.text, textAlign: "center", letterSpacing: 1 },
  lead: { margin: "0 auto 22px", fontSize: 15, lineHeight: 1.6, textAlign: "center", maxWidth: 460 },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 },
  stat: { background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, padding: "12px 14px" },
  statLabel: { fontSize: 12, letterSpacing: 1.5, color: C.faint, textTransform: "uppercase", fontWeight: 700 },
  statValue: { fontSize: 20, fontWeight: 800, color: C.text, marginTop: 4 },
  statSub: { fontSize: 11, color: C.faint, marginTop: 2 },
  owned: { textAlign: "center", fontSize: 14, marginTop: 14, marginBottom: 0 },
  mint: {
    display: "block", width: "100%", marginTop: 16, padding: "14px 20px",
    background: C.teal, color: C.ink, border: "none", borderRadius: 8,
    fontSize: 16, fontWeight: 800, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit",
  },
  notice: {
    marginTop: 18, padding: "12px 14px", fontSize: 13, lineHeight: 1.6,
    background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, color: C.dim,
  },
  code: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, wordBreak: "break-all" },
  footer: { marginTop: 20, fontSize: 11, color: C.faint, textAlign: "center" },
};
