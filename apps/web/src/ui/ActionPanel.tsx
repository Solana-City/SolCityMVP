"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { NPCAction } from "@/game/config/npcRegistry";
import type { EarnListing, EarnListingType } from "@/game/solana/superteamEarn";
import { transactionLog } from "@/game/telemetry/transactionLog";
import { profileManager } from "@/game/config/profileManager";
import {
  SEND_TOKENS, DEFAULT_SEND_TOKEN, getSendToken, explorerUrl,
  type SendToken,
} from "@/game/solana/sendTokens";
import { ProtocolIntroGate, type IntroSpec } from "@/ui/ProtocolIntro";
import CityGuide from "@/ui/CityGuide";
import MagicBlockHub from "@/ui/MagicBlockHub";
import StockExchangePanel from "@/ui/StockExchangePanel";
import { chamferBox, chamferRectPoints } from "@/ui/chamfer";
import { CloseButton, PanelTitleBar, ProtocolLogo, ExternalLinkIcon } from "@/ui/PixelIcons";
import { CATEGORY_META } from "@/game/minimap/categories";
import PegRiskPanel from "@/ui/PegRiskPanel";
import CloakPanel from "@/ui/CloakPanel";
import OreMinePanel from "@/ui/OreMinePanel";
import TokenScanPanel from "@/ui/TokenScanPanel";
import DonationPanel from "@/ui/DonationPanel";
import { backdropClose } from "@/ui/backdrop";
import { useViewportBox, overlayBox } from "@/ui/useViewportBox";
import { useButtonFeel, feelStyle, type ButtonFeel } from "@/ui/useButtonFeel";

/** Every protocol NPC's app window uses the map legend's "Protocols" color. */
const PROTOCOLS_COLOR = CATEGORY_META.defi.color;

/** Pratik: how Superteam Earn pays, before the bounty list. */
const EARN_INTRO: IntroSpec = {
  id: "earn",
  title: "HOW EARN WORKS",
  nodes: [
    { sheet: "main_char.png", label: "YOU" },
    { sheet: "Pratik.png", label: "SPONSOR" },
    { sheet: "main_char.png", label: "WINNER" },
  ],
  steps: [
    { title: "FIND", line: "Pick a bounty that fits your skills.", edge: 0 },
    { title: "COMPETE", line: "Submit your best work. Others submit too.", edge: 0 },
    { title: "WIN", line: "The sponsor picks the best work. Only winners get paid in USDC.", edge: 1, chip: "USDC" },
  ],
};

/** Jupiter Cat: what a transfer is, before the send form. */
const TRANSFER_INTRO: IntroSpec = {
  id: "transfer",
  title: "HOW SENDING WORKS",
  nodes: [
    { sheet: "main_char.png", label: "YOU" },
    { sheet: "Jupiter Joe.png", label: "JUPITER" },
    { sheet: "Kuka.png", label: "FRIEND" },
  ],
  steps: [
    { title: "PICK", line: "Choose the token. Practice SOL costs nothing to play with.", edge: 0, chip: "SOL" },
    { title: "ADDRESS", line: "Paste your friend's wallet address.", edge: 1 },
    { title: "SEND", line: "Sign and it arrives in seconds. Anyone can look the transfer up.", edge: 1, chip: "USDC" },
  ],
};

/** Raffx: what a peg is and what Pegana reads, before the peg panel. */
const PEG_RISK_INTRO: IntroSpec = {
  id: "peg-risk",
  title: "HOW A PEG CHECK WORKS",
  nodes: [
    { sheet: "main_char.png", label: "YOU" },
    { sheet: "Raffx.png", label: "RAFFX", sheetWidth: 384, sheetHeight: 64 },
    { src: "/assets/ui/attention_red.png", label: "THE READING" },
  ],
  steps: [
    { title: "ASK", line: "Pick a stablecoin or a staked-SOL token from Pegana's watch list.", edge: 0 },
    { title: "READ", line: "One word back: holding, drifting, or off peg.", edge: 1 },
    { title: "GAP", line: "Plus how far its price sits from what it is really worth.", edge: 1, chip: "bps" },
  ],
};

/** Crash: what a token scan looks at, before the scan panel. */
const TOKEN_SCAN_INTRO: IntroSpec = {
  id: "token-scan",
  title: "HOW A TOKEN SCAN WORKS",
  nodes: [
    { sheet: "main_char.png", label: "YOU" },
    { sheet: "Crash.png", label: "CRASH", sheetWidth: 384, sheetHeight: 64 },
    { src: "/assets/ui/attention_orange.png", label: "THE VERDICT" },
  ],
  steps: [
    { title: "PASTE", line: "Give Crash the address of any token.", edge: 0 },
    { title: "OPERATOR", line: "SolSentry scores the wallet behind it, not just the contract.", edge: 1 },
    { title: "VERDICT", line: "Risk level, what was found, and how many rugs that wallet already has.", edge: 1 },
  ],
};

/** Vitin: what a private balance is, before the Cloak panel. */
const CLOAK_INTRO: IntroSpec = {
  id: "cloak",
  title: "HOW PRIVATE SENDING WORKS",
  nodes: [
    { sheet: "main_char.png", label: "YOU" },
    { sheet: "Cloak.png", label: "CLOAK", sheetWidth: 384, sheetHeight: 64 },
    { sheet: "Kuka.png", label: "ANYONE" },
  ],
  steps: [
    { title: "SHIELD", line: "Move SOL into a private balance only you can spend.", edge: 0, chip: "SOL" },
    { title: "SEND", line: "Pay any address. The chain never sees you as the sender.", edge: 1 },
    { title: "UNSHIELD", line: "Take it back out to a normal wallet whenever you want.", edge: 0, chip: "SOL" },
  ],
};

/** Jupiter Cat: what a swap is, before the swap form. */
const SWAP_INTRO: IntroSpec = {
  id: "swap",
  title: "HOW A SWAP WORKS",
  nodes: [
    { sheet: "main_char.png", label: "YOU" },
    { sheet: "Jupiter Joe.png", label: "JUPITER" },
    { sheet: "main_char.png", label: "YOU" },
  ],
  steps: [
    { title: "PICK", line: "Choose the token you have and the one you want.", edge: 0, chip: "SOL" },
    { title: "BEST PRICE", line: "Jupiter checks Solana markets for the best rate.", edge: 1 },
    { title: "SWAP", line: "Sign once. The new token lands in your wallet.", edge: 1, chip: "USDC" },
  ],
};

/** ORE Miner: what the board is, before the claim office. */
const ORE_INTRO: IntroSpec = {
  id: "ore-mine",
  title: "HOW THE ORE BOARD WORKS",
  nodes: [
    { sheet: "main_char.png", label: "YOU" },
    { sheet: "main_char.png", label: "THE BOARD" },
    { sheet: "main_char.png", label: "PAYOUT" },
  ],
  steps: [
    { title: "PICK", line: "The board has 25 squares. Miners put SOL on the ones they like.", edge: 0 },
    { title: "WAIT", line: "A round lasts about a minute, then the board closes and scores it.", edge: 0 },
    { title: "COLLECT", line: "Squares that paid out send ORE and SOL back to the miner.", edge: 1, chip: "ORE" },
  ],
};

/** Stocks Broker: what a tokenized stock is, before the exchange. */
const STOCK_INTRO: IntroSpec = {
  id: "stock-exchange",
  title: "HOW STOCKS WORK",
  nodes: [
    { sheet: "main_char.png", label: "YOU" },
    { sheet: "Jupiter Joe.png", label: "JUPITER" },
    { sheet: "main_char.png", label: "SHAREHOLDER" },
  ],
  steps: [
    { title: "PICK", line: "Choose a stock: NVIDIA, Tesla, SpaceX and more.", edge: 0 },
    { title: "BUY", line: "Pay from $1 in USDC or SOL. Jupiter finds the best price.", edge: 0, chip: "USDC" },
    { title: "OWN", line: "Most tokens are backed 1:1 by a real share. Pre-IPO ones track a private company through an SPV.", edge: 1, chip: "NVDA" },
  ],
};

function emitGameEvent(event: string): void {
  ((globalThis as any).__solCityGameEvents)?.emit(event);
}

interface ActionPanelProps {
  action: NPCAction | null;
  onClose: () => void;
}

export default function ActionPanel({ action, onClose }: ActionPanelProps) {
  const [isTouch, setIsTouch] = useState(false);
  // Anchored to the VISIBLE viewport: with the browser's address bar showing,
  // a fixed inset-0 box hangs off the bottom of the screen and takes the sheet
  // with it. See useViewportBox.
  const viewport = useViewportBox();

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!action) return null;

  // ── Mobile: bottom-sheet ────────────────────────────────────────────────
  if (isTouch) {
    return (
      <div className="z-40 flex items-end justify-center" style={overlayBox(viewport)}>
        <div
          className="absolute inset-0"
          style={{ background: "rgba(6,10,20,0.55)" }}
          {...backdropClose(onClose)}
        />
        <div
          className="relative w-full rounded-t-2xl"
          style={{
            background: "rgba(10,10,30,0.98)",
            border: "1px solid rgba(183,233,40,0.25)",
            borderBottom: "none",
            fontFamily: '"Press Start 2P", monospace',
            maxHeight: "100%",
            overflowY: "auto",
            maxWidth: 480,
            padding: "16px 16px 0",
            paddingBottom: "max(env(safe-area-inset-bottom, 16px), 20px)",
          }}
        >
          {/* Drag handle */}
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(183,233,40,0.35)", margin: "0 auto 16px" }} />
          {action.type === "tutor" && <CloseButton onClick={onClose} style={{ position: "absolute", top: 16, right: 16 }} />}

          {action.type === "tutor"           && <TutorPanel           onClose={onClose} />}
          {action.type === "swap"            && <JupiterPanel onClose={onClose} tab="swap" />}
          {action.type === "transfer"        && <JupiterPanel onClose={onClose} tab="send" to={action.recipient} toName={action.recipientName} token={action.token} />}
          {action.type === "bounties"        && <ProtocolIntroGate spec={EARN_INTRO}><BountiesPanel onClose={onClose} /></ProtocolIntroGate>}
          {action.type === "private-payment" && (
            <MagicBlockHub onClose={onClose}><PrivatePaymentPanel onClose={onClose} /></MagicBlockHub>
          )}
          {action.type === "stock-exchange"  && <ProtocolIntroGate spec={STOCK_INTRO}><StockExchangePanel onClose={onClose} /></ProtocolIntroGate>}
          {/* ST Brasil stands: the project's own public API behind the button. */}
          {action.type === "peg-risk"        && <ProtocolIntroGate spec={PEG_RISK_INTRO}><PegRiskPanel onClose={onClose} /></ProtocolIntroGate>}
          {action.type === "token-scan"      && <ProtocolIntroGate spec={TOKEN_SCAN_INTRO}><TokenScanPanel onClose={onClose} /></ProtocolIntroGate>}
          {action.type === "private-transfer" && <ProtocolIntroGate spec={CLOAK_INTRO}><CloakPanel onClose={onClose} /></ProtocolIntroGate>}
          {action.type === "ore-mine"        && <ProtocolIntroGate spec={ORE_INTRO}><OreMinePanel onClose={onClose} /></ProtocolIntroGate>}
          {/* No intro gate: the panel leads with what a donation is, which is
              the only thing a walkthrough would have said. */}
          {action.type === "donation"       && <DonationPanel onClose={onClose} />}
        </div>
      </div>
    );
  }

  // ── Desktop: centered modal ─────────────────────────────────────────────
  return (
    <div className="z-40 flex items-center justify-center" style={overlayBox(viewport)}>
      <div
        className="absolute inset-0"
        style={{ background: "rgba(6,10,20,0.6)" }}
        {...backdropClose(onClose)}
      />
      <div
        className="relative p-6 w-full max-w-md"
        style={{
          background: "rgba(10,10,30,0.97)",
          borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
          borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
          imageRendering: "pixelated",
          fontFamily: '"Press Start 2P", monospace',
          maxHeight: "90dvh",
          overflowY: "auto",
        }}
      >
        {action.type === "tutor" && <CloseButton onClick={onClose} style={{ position: "absolute", top: 16, right: 16 }} />}

        {action.type === "tutor"           && <TutorPanel           onClose={onClose} />}
        {action.type === "swap"            && <JupiterPanel onClose={onClose} tab="swap" />}
        {action.type === "transfer"        && <JupiterPanel onClose={onClose} tab="send" to={action.recipient} toName={action.recipientName} token={action.token} />}
        {action.type === "bounties"        && <ProtocolIntroGate spec={EARN_INTRO}><BountiesPanel onClose={onClose} /></ProtocolIntroGate>}
        {action.type === "private-payment" && (
            <MagicBlockHub onClose={onClose}><PrivatePaymentPanel onClose={onClose} /></MagicBlockHub>
          )}
        {action.type === "stock-exchange"  && <ProtocolIntroGate spec={STOCK_INTRO}><StockExchangePanel onClose={onClose} /></ProtocolIntroGate>}
          {/* ST Brasil stands: the project's own public API behind the button. */}
          {action.type === "peg-risk"        && <ProtocolIntroGate spec={PEG_RISK_INTRO}><PegRiskPanel onClose={onClose} /></ProtocolIntroGate>}
          {action.type === "token-scan"      && <ProtocolIntroGate spec={TOKEN_SCAN_INTRO}><TokenScanPanel onClose={onClose} /></ProtocolIntroGate>}
          {action.type === "private-transfer" && <ProtocolIntroGate spec={CLOAK_INTRO}><CloakPanel onClose={onClose} /></ProtocolIntroGate>}
          {action.type === "ore-mine"        && <ProtocolIntroGate spec={ORE_INTRO}><OreMinePanel onClose={onClose} /></ProtocolIntroGate>}
          {/* No intro gate: the panel leads with what a donation is, which is
              the only thing a walkthrough would have said. */}
          {action.type === "donation"       && <DonationPanel onClose={onClose} />}
      </div>
    </div>
  );
}

// ── Jupiter Cat: swap and send under one roof ─────────────────────────

type JupiterTab = "swap" | "send";

/**
 * Jupiter Cat does both jobs now, so the two forms live behind one pair of
 * tabs rather than two NPCs on opposite sides of the city.
 *
 * Each tab keeps its own intro gate: the ids are unchanged, so a player who
 * already dismissed the swap walkthrough still gets the sending one the first
 * time they open SEND, and neither comes back twice.
 */
function JupiterPanel({ onClose, tab: initialTab, to, toName, token }: {
  onClose: () => void;
  tab: JupiterTab;
  to?: string;
  toName?: string;
  /** Which send-catalog entry to open on. See NPCAction.token. */
  token?: string;
}) {
  // Opened from a player's card, SEND is the point, so it starts there.
  const [tab, setTab] = useState<JupiterTab>(initialTab);
  const tabs = <PanelTabs tab={tab} onTab={setTab} />;

  return tab === "swap"
    ? <ProtocolIntroGate spec={SWAP_INTRO}><SwapPanel onClose={onClose} tabs={tabs} /></ProtocolIntroGate>
    : <ProtocolIntroGate spec={TRANSFER_INTRO}><TransferPanel onClose={onClose} to={to} toName={toName} token={token} tabs={tabs} /></ProtocolIntroGate>;
}

function PanelTabs({ tab, onTab }: { tab: JupiterTab; onTab: (t: JupiterTab) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
      <PanelTab label="SWAP" active={tab === "swap"} onClick={() => onTab("swap")} />
      <PanelTab label="SEND" active={tab === "send"} onClick={() => onTab("send")} />
    </div>
  );
}

function PanelTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick}
      {...feel.handlers}
      style={chamferBox(6, {
        flex: 1,
        padding: "8px 0",
        background: active ? PROTOCOLS_COLOR : "#12122a",
        color: active ? "#000" : "#777788",
        border: active ? "none" : "1px solid rgba(255,255,255,0.06)",
        cursor: active ? "default" : "pointer",
        fontFamily: '"Press Start 2P", monospace',
        fontSize: "7px",
        ...(active ? null : feelStyle(feel)),
      })}
    >
      {label}
    </button>
  );
}

// ── Swap Panel (Jupiter Swap V2: /order + /execute) ───────────────────

function SwapPanel({ onClose, tabs }: { onClose: () => void; tabs?: React.ReactNode }) {
  const { connected, publicKey, signTransaction } = useWallet();
  const [inputToken,  setInputToken]  = useState("SOL");
  const [outputToken, setOutputToken] = useState("USDC");
  const [amount,  setAmount]  = useState("0.1");
  const [quote,   setQuote]   = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [status,  setStatus]  = useState<"idle"|"quoting"|"signing"|"submitting"|"done"|"error">("idle");
  const [result,  setResult]  = useState<{ signature?: string; outAmount?: string; error?: string } | null>(null);
  const quotedAt = useRef(0);
  const closeFeel = useButtonFeel();
  const retryFeel = useButtonFeel();
  const quoteFeel = useButtonFeel();
  const swapFeel = useButtonFeel();

  const jupRef = useRef<typeof import("@/game/solana/jupiterSwap") | null>(null);
  useEffect(() => { import("@/game/solana/jupiterSwap").then(m => { jupRef.current = m; }); }, []);

  const handleQuote = useCallback(async () => {
    const jup = jupRef.current;
    if (!jup || !publicKey || !amount) return;
    const input  = jup.getTokenBySymbol(inputToken);
    const output = jup.getTokenBySymbol(outputToken);
    if (!input || !output) return;

    setLoading(true);
    setStatus("quoting");
    setResult(null);
    try {
      const smallest = jup.toSmallestUnit(amount, input.decimals);
      const q = await jup.getOrder({
        inputMint: input.mint, outputMint: output.mint, amount: smallest, taker: publicKey.toBase58(),
      });
      quotedAt.current = Date.now();
      setQuote(q);
      setStatus("idle");
    } catch (err: any) {
      setResult({ error: err.message });
      setStatus("error");
    }
    setLoading(false);
  }, [publicKey, inputToken, outputToken, amount]);

  const handleSwap = useCallback(async () => {
    const jup = jupRef.current;
    if (!jup || !quote || !signTransaction || !publicKey) return;

    const logEntry = transactionLog.record({
      kind: "swap",
      layer: "jupiter",
      label: `Swap ${amount} ${inputToken} → ${outputToken}`,
      status: "pending",
    });

    setStatus("signing");
    try {
      // The order's requestId expires; re-quote a stale one before signing.
      let order = quote;
      if (Date.now() - quotedAt.current > jup.ORDER_TTL_MS) {
        order = await jup.getOrder({
          inputMint: quote.inputMint, outputMint: quote.outputMint, amount: quote.inAmount, taker: publicKey.toBase58(),
        });
      }

      // Wallet signs only; Jupiter /execute lands it on mainnet.
      const signed = await signTransaction(jup.deserializeTransaction(order.transaction!) as any);
      setStatus("submitting");
      const executed = await jup.executeOrder(signed as any, order.requestId);
      const signature = executed.signature ?? "";
      const outAmount = executed.totalOutputAmount ?? executed.outputAmountResult ?? order.outAmount;

      const outToken = jup.getTokenByMint(order.outputMint);
      const outHuman = outToken
        ? jup.fromSmallestUnit(outAmount, outToken.decimals)
        : outAmount;

      setResult({ signature, outAmount: outHuman });
      setStatus("done");
      transactionLog.markConfirmed(logEntry.id, signature);
      profileManager.recordSwap({ inputToken, outputToken, amount });
      emitGameEvent("game:swap");
    } catch (err: any) {
      setResult({ error: err.message });
      setStatus("error");
      transactionLog.markFailed(logEntry.id, err.message ?? "swap failed");
    }
  }, [quote, signTransaction, publicKey, amount, inputToken, outputToken]);

  const tokens = TOKEN_LIST_SYMBOLS;

  const getTokenLogo = (symbol: string) => {
    const jup = jupRef.current;
    return jup?.getTokenBySymbol(symbol)?.logo ?? "";
  };

  if (status === "done" && result) {
    return (
      <>
        <PanelTitleBar title="TOKEN SWAP" onClose={onClose} color={PROTOCOLS_COLOR} logo={<ProtocolLogo sheet="Jupiter Joe.png" />} />
        <div className="text-center py-6">
          <div style={{ fontSize: 22, color: "#B7E928" }}>OK</div>
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "8px", color: "#B7E928", marginTop: 8 }}>
            SWAP COMPLETE
          </div>
          <div style={{ fontSize: "9px", color: "#888899", marginTop: 8 }}>
            Received: {result.outAmount} {outputToken}
          </div>
          {result.signature && (
            <a href={`https://solscan.io/tx/${result.signature}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 8, fontSize: "9px", color: "#14F0C6" }}>
              View on Solscan <ExternalLinkIcon size={9} color="#14F0C6" />
            </a>
          )}
          <button onClick={onClose} {...closeFeel.handlers} style={btnStyle("#B7E928", "#fff", closeFeel)} className="w-full mt-4">CLOSE</button>
        </div>
      </>
    );
  }

  if (status === "error" && result) {
    return (
      <>
        <PanelTitleBar title="TOKEN SWAP" onClose={onClose} color={PROTOCOLS_COLOR} logo={<ProtocolLogo sheet="Jupiter Joe.png" />} />
        <div className="text-center py-6">
          <div style={{ fontSize: "9px", color: "#ff4444", marginBottom: 12 }}>{result.error}</div>
          <button onClick={() => { setStatus("idle"); setResult(null); setQuote(null); }}
            {...retryFeel.handlers} style={btnStyle("#333344", "#888899", retryFeel)} className="px-4 py-2">Try again</button>
        </div>
      </>
    );
  }

  return (
    <>
      <PanelTitleBar title="TOKEN SWAP" onClose={onClose} color={PROTOCOLS_COLOR} logo={<ProtocolLogo sheet="Jupiter Joe.png" />} />
      {tabs}

      {/* ⚠️ mainnet note */}
      <div style={{ fontSize: "7px", color: "#555566", marginBottom: 12, textAlign: "center" }}>
        Jupiter operates on mainnet · real SOL required
      </div>

      {/* Input token */}
      <TokenBox label="From" token={inputToken} onTokenChange={(t) => { setInputToken(t); setQuote(null); }}
        excludeToken={outputToken} tokens={tokens} getLogo={getTokenLogo}>
        <input type="text" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }}
          placeholder="0.0" style={{ background: "transparent", color: "#fff", border: "none", fontSize: 15, fontFamily: "monospace", width: "100%", outline: "none" }} />
      </TokenBox>

      <div style={{ textAlign: "center", color: "#555566", marginBottom: 4 }}>↓</div>

      {/* Output token */}
      <TokenBox label="To" token={outputToken} onTokenChange={(t) => { setOutputToken(t); setQuote(null); }}
        excludeToken={inputToken} tokens={tokens} getLogo={getTokenLogo}>
        <div style={{ fontSize: 15, fontFamily: "monospace", color: quote ? "#fff" : "#333344" }}>
          {quote
            ? (() => { const jup = jupRef.current; const out = jup?.getTokenBySymbol(outputToken); return out ? jup?.fromSmallestUnit(quote.outAmount, out.decimals) : "..."; })()
            : "..."}
        </div>
      </TokenBox>

      {quote && (
        <div style={{ fontSize: "8px", color: "#555566", display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <span>via Jupiter</span>
          <span>slippage: {quote.slippageBps ? `${(quote.slippageBps / 100).toFixed(1)}%` : "auto"}</span>
          <span>impact: {Math.abs(quote.priceImpact ?? parseFloat(quote.priceImpactPct ?? "0") * 100).toFixed(2)}%</span>
        </div>
      )}

      <div className="flex gap-2 mt-4">
        {!quote ? (
          <button onClick={handleQuote} disabled={!connected || loading || !amount}
            {...quoteFeel.handlers} style={btnStyle(connected ? "#FFD700" : "#333344", connected ? "#000" : "#666677", quoteFeel)} className="flex-1 py-2.5">
            {!connected ? "CONNECT WALLET FIRST" : loading ? "GETTING QUOTE..." : "GET QUOTE"}
          </button>
        ) : (
          <button onClick={handleSwap} disabled={status === "signing" || status === "submitting"}
            {...swapFeel.handlers} style={btnStyle("#B7E928", "#000", swapFeel)} className="flex-1 py-2.5">
            {status === "signing" ? "SIGN IN WALLET..." : status === "submitting" ? "SUBMITTING..." : "CONFIRM SWAP"}
          </button>
        )}
      </div>
    </>
  );
}

// ── Transfer Panel ────────────────────────────────────────────────────

/**
 * Sending, for every token the city knows about.
 *
 * The catalog in sendTokens.ts carries a cluster per entry, because the game
 * itself runs on devnet while USDC, USDT, SKR and the rest only exist on
 * mainnet. SOL appears twice on purpose. The line under the recipient is the
 * only thing standing between practice money and real money, so it says which
 * one is loaded in plain words and the confirm button repeats it.
 */
function TransferPanel({ onClose, to, toName, token: initialToken, tabs }: {
  onClose: () => void;
  to?: string;
  toName?: string;
  /** Opens on this catalog entry instead of the practice default. */
  token?: string;
  tabs?: React.ReactNode;
}) {
  const { connected, publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();
  // Opened from a player's card: their wallet is already in the box.
  const [recipient, setRecipient] = useState(to ?? "");
  // A caller that names a token gets it, as long as it is one we actually
  // have; anything unknown falls back to practice money rather than guessing.
  const [tokenId, setTokenId] = useState(
    initialToken && getSendToken(initialToken) ? initialToken : DEFAULT_SEND_TOKEN.id,
  );
  const [amount, setAmount] = useState("0.01");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [result, setResult] = useState<{ signature?: string; error?: string } | null>(null);
  const closeFeel = useButtonFeel();
  const retryFeel = useButtonFeel();
  const sendFeel = useButtonFeel();

  const token = getSendToken(tokenId) ?? DEFAULT_SEND_TOKEN;
  const real = token.cluster === "mainnet";

  const handleSend = useCallback(async () => {
    if (!publicKey || !recipient || !amount) return;
    const { isValidAddress } = await import("@/game/solana/transfer");
    const { buildSendTransfer, sendTokenLabel, normalizeAmount } = await import("@/game/solana/sendTokens");
    const { PublicKey } = await import("@solana/web3.js");

    if (!isValidAddress(recipient)) { setResult({ error: "Invalid Solana address" }); setStatus("error"); return; }
    // Same normalizing the builder does, so "0,5" is not rejected here and
    // then accepted there (or the other way round).
    const clean = normalizeAmount(amount);
    if (clean === null || parseFloat(clean) <= 0) { setResult({ error: "Invalid amount" }); setStatus("error"); return; }

    setStatus("sending");
    const logEntry = transactionLog.record({
      kind: "transfer",
      // Both clusters are the base layer; the label carries which one it was.
      layer: "base",
      label: `Send ${amount} ${sendTokenLabel(token)} to ${recipient.slice(0, 4)}…${recipient.slice(-4)}`,
      status: "pending",
    });
    try {
      // The amount goes in as typed: buildSendTransfer converts it without a
      // float, so 0.1 is exactly 0.1 and not the nearest double.
      const { tx, connection: conn } = await buildSendTransfer({
        token,
        devnetConnection: connection,
        from: publicKey,
        to: new PublicKey(recipient),
        amount,
      });
      // Sign only, then send it ourselves over `conn`, which is this token's
      // own cluster. Phantom's sendTransaction overrides the adapter's and
      // hands the transaction to the wallet's signAndSendTransaction, which
      // broadcasts on whatever network the wallet happens to be set to and
      // uses our connection for nothing but the blockhash. That would send
      // mainnet USDC over a devnet wallet setting and fail, or worse pick the
      // cluster the player did not choose. Signing involves no network, so
      // this keeps the cluster ours. (The sendTransaction fallback is for
      // wallets that only ever sign-and-send; it is the old behaviour.)
      const sig = signTransaction
        ? await conn.sendRawTransaction((await signTransaction(tx)).serialize())
        : await sendTransaction(tx, conn);
      await conn.confirmTransaction(sig, "confirmed");
      setResult({ signature: sig });
      setStatus("done");
      transactionLog.markConfirmed(logEntry.id, sig);
      profileManager.recordTransfer({ recipient, amount });
      emitGameEvent("game:transfer");
    } catch (err: any) {
      setResult({ error: err.message });
      setStatus("error");
      transactionLog.markFailed(logEntry.id, err.message ?? "transfer failed");
    }
  }, [publicKey, recipient, amount, connection, signTransaction, sendTransaction, token]);

  if (status === "done" && result?.signature) {
    return (
      <>
        <PanelTitleBar title="SEND TOKENS" onClose={onClose} color={PROTOCOLS_COLOR} logo={<ProtocolLogo sheet="Jupiter Joe.png" />} />
        <div className="text-center py-6">
          <div style={{ fontSize: 22, color: "#B7E928" }}>OK</div>
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "8px", color: "#B7E928", marginTop: 8 }}>TRANSFER SENT</div>
          <div style={{ fontSize: "9px", color: "#888899", marginTop: 8 }}>{amount} {token.symbol} sent</div>
          <a href={explorerUrl(result.signature, token.cluster)} target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 8, fontSize: "9px", color: "#14F0C6" }}>
            View on Explorer <ExternalLinkIcon size={9} color="#14F0C6" />
          </a>
          <button onClick={onClose} {...closeFeel.handlers} style={btnStyle("#14F0C6", "#000", closeFeel)} className="w-full mt-4">CLOSE</button>
        </div>
      </>
    );
  }

  if (status === "error" && result) {
    return (
      <>
        <PanelTitleBar title="SEND TOKENS" onClose={onClose} color={PROTOCOLS_COLOR} logo={<ProtocolLogo sheet="Jupiter Joe.png" />} />
        <div className="text-center py-6">
          <div style={{ fontSize: "9px", color: "#ff4444", marginBottom: 12 }}>{result.error}</div>
          <button onClick={() => { setStatus("idle"); setResult(null); }} {...retryFeel.handlers} style={btnStyle("#333344", "#888899", retryFeel)} className="px-4 py-2">Try again</button>
        </div>
      </>
    );
  }

  return (
    <>
      <PanelTitleBar title="SEND TOKENS" onClose={onClose} color={PROTOCOLS_COLOR} logo={<ProtocolLogo sheet="Jupiter Joe.png" />} />
      {tabs}

      <SendTokenBox token={token} onTokenChange={(id) => { setTokenId(id); setResult(null); }}>
        <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.01"
          style={{ background: "transparent", color: "#fff", border: "none", fontSize: 15, fontFamily: "monospace", width: "100%", outline: "none", fontWeight: "bold" }} />
      </SendTokenBox>

      <InputBox label={toName ? `Recipient (${toName})` : "Recipient address"}>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)}
          placeholder="Paste Solana address…"
          style={{ background: "transparent", color: "#fff", border: "none", fontSize: 9, fontFamily: "monospace", width: "100%", outline: "none" }} />
      </InputBox>

      <div style={{ fontSize: "7px", color: real ? "#FFD700" : "#555566", marginTop: 4, marginBottom: 12, textAlign: "center" }}>
        {real
          ? `${token.symbol} on mainnet. Real money leaves your wallet.`
          : "Practice SOL on devnet. Costs you nothing."}
      </div>

      <div className="flex gap-2">
        <button onClick={handleSend} disabled={!connected || status === "sending" || !recipient || !amount}
          {...sendFeel.handlers} style={btnStyle(connected ? "#14F0C6" : "#333344", connected ? "#000" : "#666677", sendFeel)} className="flex-1 py-2.5">
          {!connected ? "CONNECT WALLET FIRST"
            : status === "sending" ? "SENDING…"
            : real ? `SEND REAL ${token.symbol}` : "SEND PRACTICE SOL"}
        </button>
      </div>
    </>
  );
}

/**
 * The amount box with the token picker in its corner. Separate from the swap
 * panel's TokenBox because the options here are catalog entries, not bare
 * symbols: two of them read "SOL" and only the cluster tells them apart.
 */
function SendTokenBox({ token, onTokenChange, children }: {
  token: SendToken;
  onTokenChange: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div style={chamferBox(8, { background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", padding: 12, marginBottom: 8 })}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: "8px", color: "#555566" }}>Amount</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {token.logo && <img src={token.logo} alt={token.symbol} style={{ width: 18, height: 18, borderRadius: "50%" }} />}
          <select value={token.id} onChange={(e) => onTokenChange(e.target.value)}
            style={chamferBox(4, { background: "#1a1a3a", color: "#B7E928", border: "1px solid rgba(183,233,40,0.2)", padding: "2px 6px", fontSize: "9px", cursor: "pointer", outline: "none" })}>
            {SEND_TOKENS.map(t => (
              <option key={t.id} value={t.id}>{t.symbol} · {t.note}</option>
            ))}
          </select>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Bounties Panel (Superteam Earn) ──────────────────────────────────

type EarnCategory = {
  type: EarnListingType;
  label: string;
  sublabel: string;
  color: string;
  viewAllUrl: string;
};

const EARN_CATEGORIES: EarnCategory[] = [
  { type: "bounty",    label: "Bounties",         sublabel: "Short tasks",            color: "#B7E928", viewAllUrl: "https://superteam.fun/earn/all?tab=bounties"    },
  { type: "project",   label: "Projects",          sublabel: "Longer work",            color: "#14F0C6", viewAllUrl: "https://superteam.fun/earn/all?tab=projects"    },
  { type: "grant",     label: "Grants",            sublabel: "Funding to build",       color: "#9945FF", viewAllUrl: "https://superteam.fun/earn/grants"              },
  { type: "hackathon", label: "Hackathons",        sublabel: "Build and compete",      color: "#FFD700", viewAllUrl: "https://superteam.fun/earn/all?tab=hackathons"   },
];


function BountiesPanel({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<EarnCategory | null>(null);

  if (selected) {
    return <EarnListingsStage category={selected} onBack={() => setSelected(null)} onClose={onClose} />;
  }

  return (
    <>
      <PanelTitleBar title="SUPERTEAM EARN" onClose={onClose} color={PROTOCOLS_COLOR} logo={<ProtocolLogo sheet="Pratik.png" />} style={{ marginBottom: 10 }} />

      <p style={{ fontSize: "8px", color: "#b9b9cc", margin: "0 0 14px", lineHeight: 1.6 }}>
        Pick a category. Only selected work gets paid, in USDC.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        {EARN_CATEGORIES.map((cat) => (
          <div
            key={cat.type}
            onClick={() => setSelected(cat)}
            style={chamferBox(8, {
              background: "#12122a",
              border: `1px solid ${cat.color}33`,
              padding: 12,
              cursor: "pointer",
              transition: "border-color 0.15s",
            })}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.setProperty("--cbc", `${cat.color}66`); }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.setProperty("--cbc", `${cat.color}33`); }}
          >
            <div style={{ fontSize: "8px", color: cat.color, fontWeight: "bold", marginBottom: 4 }}>
              {cat.label}
            </div>
            <div style={{ fontSize: "8px", color: "#777788" }}>
              {cat.sublabel}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function EarnListingsStage({
  category,
  onBack,
  onClose,
}: {
  category: EarnCategory;
  onBack: () => void;
  onClose: () => void;
}) {
  const [listings, setListings] = useState<EarnListing[]>([]);
  const [loading, setLoading]   = useState(true);
  const [failed, setFailed]     = useState(false);
  const backFeel = useButtonFeel();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setListings([]);

    import("@/game/solana/superteamEarn").then(({ fetchEarnListings }) => {
      fetchEarnListings(category.type, 8)
        .then((items) => {
          if (!cancelled) { setListings(items); setLoading(false); }
        })
        .catch(() => {
          if (!cancelled) { setFailed(true); setLoading(false); }
        });
    });

    return () => { cancelled = true; };
  }, [category.type]);

  const formatDeadline = (deadline: string | null) => {
    if (!deadline) return "Open";
    try {
      const d = new Date(deadline);
      return `Due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    } catch {
      return "Open";
    }
  };


  const isGrants = category.type === "grant";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button
          onClick={onBack}
          {...backFeel.handlers}
          style={chamferBox(6, { background: "transparent", border: `1px solid ${category.color}44`, color: category.color, padding: "4px 10px", cursor: "pointer", fontFamily: '"Press Start 2P", monospace', fontSize: "7px", ...feelStyle(backFeel) })}
        >
          ← BACK
        </button>
        <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "8px", color: category.color, margin: 0 }}>
          {category.label.toUpperCase()}
        </h3>
      </div>

      <div style={{ maxHeight: isGrants ? 360 : 280, overflowY: "auto" }}>

        {/* ── Grants: informational panel (always shown) ── */}
        {isGrants && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              <StepCard number={1} title="Propose" color="#9945FF" description="Send a short plan for what you will build." />
              <StepCard number={2} title="Get approved" color="#14F0C6" description="The grant team reviews it, usually in 1 to 3 weeks." />
              <StepCard number={3} title="Build" color="#B7E928" description="Paid in USDC. No equity taken." />
            </div>
            {/* Divider before live listings */}
            <div style={{ fontSize: "7px", color: "#555566", textAlign: "center", marginBottom: 10, letterSpacing: 2 }}>
              OPEN GRANTS
            </div>
          </div>
        )}

        {/* ── Loading state ── */}
        {loading && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#555566", fontSize: "8px" }}>
            Loading listings…
          </div>
        )}

        {/* ── Empty / error state ── */}
        {!loading && (failed || listings.length === 0) && (
          <div style={{ textAlign: "center", padding: isGrants ? "12px 0" : "20px 0" }}>
            <div style={{ fontSize: "8px", color: "#777788", marginBottom: 12, lineHeight: 1.6 }}>
              {failed
                ? "Couldn't load listings right now."
                : isGrants
                  ? "No open grants right now."
                  : "No open listings right now."}
            </div>
            <a
              href={category.viewAllUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "8px", color: category.color, textDecoration: "none" }}
            >
              Browse all {category.label.toLowerCase()} <ExternalLinkIcon size={8} color={category.color} />
            </a>
          </div>
        )}

        {/* ── Live listings ── */}
        {!loading && !failed && listings.map((listing, i) => (
          <a
            key={i}
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            style={chamferBox(8, {
              display: "block",
              background: "#12122a",
              border: "1px solid rgba(255,255,255,0.04)",
              padding: 12,
              marginBottom: 8,
              textDecoration: "none",
              transition: "border-color 0.15s",
            })}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.setProperty("--cbc", `${category.color}33`); }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.setProperty("--cbc", "rgba(255,255,255,0.04)"); }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#ccccdd", fontSize: "9px", marginBottom: 3, lineHeight: 1.5 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{listing.title}</span>
                  <ExternalLinkIcon size={8} color="#555566" />
                </div>
                <div style={{ fontSize: "8px", color: "#555566" }}>{listing.sponsorName}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "7px", color: category.color }}>
                  {listing.rewardAmount ? `$${listing.rewardAmount} ${listing.token}` : "Variable"}
                </div>
                <div style={{ fontSize: "7px", color: "#555566", marginTop: 3 }}>
                  {formatDeadline(listing.deadline)}
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <a
          href={category.viewAllUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={chamferBox(8, { flex: 1, background: `${category.color}18`, color: category.color, border: `1px solid ${category.color}33`, padding: "10px 0", textAlign: "center", fontFamily: '"Press Start 2P", monospace', fontSize: "7px", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 })}
        >
          SEE ALL {category.label.toUpperCase()} <ExternalLinkIcon size={8} color={category.color} />
        </a>
      </div>
    </>
  );
}

// ── Tutor Panel ───────────────────────────────────────────────────────

function TutorPanel({ onClose }: { onClose: () => void }) {
  return <CityGuide onDone={onClose} />;
}

// ── Private Payment Panel (MagicBlock PER) ───────────────────────────

type PayStatus =
  | "idle"
  | "authenticating"
  | "ready"
  | "depositing"
  | "transferring"
  | "withdrawing"
  | "done"
  | "error";

function PrivatePaymentPanel({ onClose }: { onClose: () => void }) {
  const { connected, publicKey, signTransaction, signMessage } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const [cluster, setCluster]           = useState<"mainnet" | "devnet">("devnet");
  const [status, setStatus]             = useState<PayStatus>("idle");
  const [authToken, setAuthToken]       = useState<string | null>(null);
  const [balance, setBalance]           = useState<number | null>(null);
  const [showBalance, setShowBalance]   = useState(false);
  const [recipient, setRecipient]       = useState("");
  const [amount, setAmount]             = useState("1");
  const [showAmount, setShowAmount]     = useState(false);
  const [depositAmt, setDepositAmt]     = useState("5");
  const [withdrawAmt, setWithdrawAmt]   = useState("1");
  const [lastAction, setLastAction]     = useState<"send" | "withdraw" | "deposit">("send");
  const [error, setError]               = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<"deposit" | "send" | "withdraw">("send");
  const [introOpen, setIntroOpen]       = useState(false);
  useEffect(() => {
    try { setIntroOpen(localStorage.getItem(PRIVATE_INTRO_KEY) !== "1"); } catch { /* storage blocked */ }
  }, []);
  const closeIntro = () => {
    try { localStorage.setItem(PRIVATE_INTRO_KEY, "1"); } catch { /* storage blocked */ }
    setIntroOpen(false);
  };
  // Nothing in the private account yet: step 1 is the only move that works.
  const pickedTabRef = useRef(false);
  useEffect(() => {
    if (balance !== null && balance <= 0 && !pickedTabRef.current) setActiveTab("deposit");
  }, [balance]);
  const connectFeel = useButtonFeel();
  const backFeel = useButtonFeel();
  const howFeel = useButtonFeel();
  const showBalanceFeel = useButtonFeel();
  const showAmountFeel = useButtonFeel();
  const emptyDepositFeel = useButtonFeel();
  const sendFeel = useButtonFeel();
  const depositFeel = useButtonFeel();
  const withdrawFeel = useButtonFeel();

  // Re-authenticate whenever cluster changes
  useEffect(() => {
    if (!connected || !publicKey || !signMessage) return;
    setStatus("authenticating");
    setAuthToken(null);
    setBalance(null);
    setError(null);

    import("@/game/solana/magicblockPayments").then(async (mb) => {
      try {
        const { token } = await mb.authenticate(publicKey, signMessage, cluster);
        setAuthToken(token);
        const bal = await mb.getPrivateBalance(publicKey.toBase58(), token, cluster);
        setBalance(bal);
        setStatus("ready");
      } catch (e: any) {
        setError(e.message ?? "Authentication failed");
        setStatus("error");
      }
    });
  }, [connected, publicKey, signMessage, cluster]);

  const refreshBalance = async () => {
    if (!authToken || !publicKey) return;
    const mb = await import("@/game/solana/magicblockPayments");
    const bal = await mb.getPrivateBalance(publicKey.toBase58(), authToken, cluster);
    setBalance(bal);
  };

  const handleDeposit = async () => {
    if (!publicKey || !signTransaction || !authToken) return;
    const parsed = parseFloat(depositAmt);
    if (isNaN(parsed) || parsed <= 0) { setError("Invalid amount"); return; }

    setStatus("depositing");
    setError(null);
    try {
      const mb = await import("@/game/solana/magicblockPayments");
      const txData = await mb.buildDeposit(publicKey.toBase58(), parsed, cluster);
      await mb.signAndSubmit(txData, signTransaction as any, authToken, cluster);
      await refreshBalance();
      setStatus("ready");
    } catch (e: any) {
      setError(e.message ?? "Deposit failed");
      setStatus("ready");
    }
  };

  const handleTransfer = async () => {
    if (!publicKey || !signTransaction || !authToken) return;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { setError("Invalid amount"); return; }
    const { isValidAddress } = await import("@/game/solana/transfer");
    if (!isValidAddress(recipient)) { setError("Invalid recipient address"); return; }
    if (balance !== null && parsed > balance) { setError("Insufficient private balance"); return; }

    setStatus("transferring");
    setError(null);
    try {
      const mb = await import("@/game/solana/magicblockPayments");
      const txData = await mb.buildPrivateTransfer(publicKey.toBase58(), recipient, parsed, authToken, cluster);
      await mb.signAndSubmit(txData, signTransaction as any, authToken, cluster);
      setLastAction("send");
      setStatus("done");
      emitGameEvent("game:transfer");
      transactionLog.record({
        kind: "transfer",
        layer: "ephemeral",
        label: `Private ${parsed} USDC (shielded)`,
        status: "confirmed",
      });
    } catch (e: any) {
      setError(e.message ?? "Transfer failed");
      setStatus("ready");
    }
  };

  const handleWithdraw = async () => {
    if (!publicKey || !signTransaction || !authToken) return;
    const parsed = parseFloat(withdrawAmt);
    if (isNaN(parsed) || parsed <= 0) { setError("Invalid amount"); return; }
    if (balance !== null && parsed > balance) { setError("Insufficient private balance"); return; }

    setStatus("withdrawing");
    setError(null);
    try {
      const mb = await import("@/game/solana/magicblockPayments");
      const txData = await mb.buildWithdraw(publicKey.toBase58(), parsed, authToken, cluster);
      await mb.signAndSubmit(txData, signTransaction as any, authToken, cluster);
      await refreshBalance();
      setLastAction("withdraw");
      setStatus("done");
      transactionLog.record({
        kind: "transfer",
        layer: "base",
        label: `Withdraw ${parsed} USDC from private balance`,
        status: "confirmed",
      });
    } catch (e: any) {
      setError(e.message ?? "Withdraw failed");
      setStatus("ready");
    }
  };

  const FUCHSIA = "#c026d3";

  if (introOpen) return <PrivateIntro onDone={closeIntro} />;

  if (!connected) {
    return (
      <>
        <PanelHeader color={FUCHSIA} title="PRIVATE TRANSFER" />
        <ClusterToggle cluster={cluster} onChange={setCluster} />
        <PrivateFlow active="deposit" />
        <div style={{ textAlign: "center", padding: "4px 0 12px", color: "#b9b9cc", fontSize: 8 }}>
          Connect a wallet to start.
        </div>
        <button onClick={() => openWalletModal(true)} {...connectFeel.handlers} style={btnStyle(FUCHSIA, "#fff", connectFeel)} className="w-full py-2.5">CONNECT WALLET</button>
      </>
    );
  }

  if (status === "authenticating") {
    return (
      <>
        <PanelHeader color={FUCHSIA} title="PRIVATE TRANSFER" />
        <ClusterToggle cluster={cluster} onChange={setCluster} disabled />
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <div style={{ fontSize: 8, color: "#888899", marginBottom: 8 }}>Authenticating with wallet…</div>
          <div style={{ fontSize: 7, color: "#555566" }}>Sign the message in your wallet to verify identity</div>
        </div>
      </>
    );
  }

  if (status === "done") {
    const isWithdraw = lastAction === "withdraw";
    return (
      <>
        <PanelHeader color={FUCHSIA} title="PRIVATE TRANSFER" />
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: 20, color: FUCHSIA, marginBottom: 8 }}>{isWithdraw ? "◇" : "◈"}</div>
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 7, color: FUCHSIA, marginBottom: 12 }}>
            {isWithdraw ? "WITHDRAWN" : "TRANSFER SHIELDED"}
          </div>
          <PrivateFlow active={isWithdraw ? "withdraw" : "send"} />
          <div style={{ fontSize: 8, color: "#888899" }}>
            {isWithdraw ? "Back in your wallet." : "Sent. No public trace."}
          </div>
        </div>
        <button onClick={() => setStatus("ready")} {...backFeel.handlers} style={btnStyle(FUCHSIA, "#fff", backFeel)} className="w-full py-2.5 mt-2">BACK</button>
      </>
    );
  }

  const stepLine = PRIVATE_STEPS.find((st) => st.id === activeTab)!.line;

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}><PanelHeader color={FUCHSIA} title="PRIVATE TRANSFER" /></div>
        <button
          onClick={() => setIntroOpen(true)}
          title="How it works"
          {...howFeel.handlers}
          style={chamferBox(6, { background: "transparent", border: `1px solid ${FUCHSIA}66`, color: FUCHSIA, padding: "4px 7px", cursor: "pointer", fontFamily: '"Press Start 2P", monospace', fontSize: 7, marginRight: 22, ...feelStyle(howFeel) })}
        >
          ? HOW
        </button>
      </div>
      <ClusterToggle cluster={cluster} onChange={setCluster} />

      {/* Private balance */}
      <div style={chamferBox(8, { background: "#0d0d22", border: `1px solid ${FUCHSIA}33`, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" })}>
        <span style={{ fontSize: 8, color: "#777788" }}>Private balance</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 8, color: FUCHSIA }}>
            {balance === null ? "…" : showBalance ? `${balance.toFixed(2)} USDC` : "●●●●"}
          </span>
          <button
            onClick={() => setShowBalance(v => !v)}
            {...showBalanceFeel.handlers}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#555566", fontSize: 11, padding: 0, lineHeight: 1, ...feelStyle(showBalanceFeel) }}
            title={showBalance ? "Hide balance" : "Show balance"}
          >
            {showBalance ? "◉" : "◎"}
          </button>
        </div>
      </div>

      {/* The flow picture is the tab bar: tap an arrow to pick the step. */}
      <PrivateFlow
        active={activeTab}
        onPick={(t) => { pickedTabRef.current = true; setActiveTab(t); setError(null); }}
      />
      <div style={{ fontSize: 8, color: "#b9b9cc", textAlign: "center", lineHeight: 1.6, marginBottom: 12 }}>
        {stepLine}
      </div>

      {/* Send tab */}
      {activeTab === "send" && (
        <>
          <InputBox label="Recipient address">
            <input
              type="text"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="Paste Solana address…"
              style={{ background: "transparent", color: "#fff", border: "none", fontSize: 8, fontFamily: "monospace", width: "100%", outline: "none" }}
            />
          </InputBox>
          <div style={chamferBox(8, { background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", padding: 12, marginBottom: 8 })}>
            <div style={{ fontSize: 8, color: "#555566", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Amount (USDC)</span>
              <button
                onClick={() => setShowAmount(v => !v)}
                {...showAmountFeel.handlers}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#555566", fontSize: 10, padding: 0, ...feelStyle(showAmountFeel) }}
                title={showAmount ? "Hide amount" : "Show amount"}
              >
                {showAmount ? "◉" : "◎"}
              </button>
            </div>
            {showAmount ? (
              <input
                type="text"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                style={{ background: "transparent", color: "#fff", border: "none", fontSize: 15, fontFamily: "monospace", width: "100%", outline: "none", fontWeight: "bold" }}
              />
            ) : (
              <div style={{ fontSize: 15, fontFamily: "monospace", color: "#777788", letterSpacing: 4 }}>●●●●</div>
            )}
          </div>
          {balance !== null && balance <= 0 && (
            <button
              onClick={() => { pickedTabRef.current = true; setActiveTab("deposit"); }}
              {...emptyDepositFeel.handlers}
              style={chamferBox(8, { display: "block", width: "100%", background: `${FUCHSIA}18`, border: `1px dashed ${FUCHSIA}`, color: FUCHSIA, padding: "8px 0", marginBottom: 10, cursor: "pointer", fontFamily: '"Press Start 2P", monospace', fontSize: 7, ...feelStyle(emptyDepositFeel) })}
            >
              EMPTY: DEPOSIT FIRST (STEP 1) ▸
            </button>
          )}
          {error && <div style={{ fontSize: 8, color: "#ff4444", marginBottom: 8, textAlign: "center" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleTransfer}
              disabled={status === "transferring" || !balance || balance <= 0}
              {...sendFeel.handlers}
              style={btnStyle(balance && balance > 0 ? FUCHSIA : "#333344", "#fff", sendFeel)}
              className="flex-1 py-2.5"
            >
              {status === "transferring" ? "SIGNING…" : "SEND PRIVATELY"}
            </button>
          </div>
        </>
      )}

      {/* Deposit tab */}
      {activeTab === "deposit" && (
        <>
          <InputBox label="Amount to deposit (USDC)">
            <input
              type="text"
              value={depositAmt}
              onChange={e => setDepositAmt(e.target.value)}
              placeholder="5.00"
              style={{ background: "transparent", color: "#fff", border: "none", fontSize: 15, fontFamily: "monospace", width: "100%", outline: "none", fontWeight: "bold" }}
            />
          </InputBox>
          {error && <div style={{ fontSize: 8, color: "#ff4444", marginBottom: 8, textAlign: "center" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={handleDeposit}
              disabled={status === "depositing"}
              {...depositFeel.handlers}
              style={btnStyle(FUCHSIA, "#fff", depositFeel)}
              className="flex-1 py-2.5"
            >
              {status === "depositing" ? "SIGNING…" : "DEPOSIT"}
            </button>
          </div>
        </>
      )}

      {/* Withdraw tab */}
      {activeTab === "withdraw" && (
        <>
          <InputBox label="Amount to withdraw (USDC)">
            <input
              type="text"
              value={withdrawAmt}
              onChange={e => setWithdrawAmt(e.target.value)}
              placeholder="1.00"
              style={{ background: "transparent", color: "#fff", border: "none", fontSize: 15, fontFamily: "monospace", width: "100%", outline: "none", fontWeight: "bold" }}
            />
          </InputBox>
          {error && <div style={{ fontSize: 8, color: "#ff4444", marginBottom: 8, textAlign: "center" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={handleWithdraw}
              disabled={status === "withdrawing" || !balance || balance <= 0}
              {...withdrawFeel.handlers}
              style={btnStyle(balance && balance > 0 ? FUCHSIA : "#333344", "#fff", withdrawFeel)}
              className="flex-1 py-2.5"
            >
              {status === "withdrawing" ? "SIGNING…" : "WITHDRAW"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function PanelHeader({ title, color }: { title: string; color: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 8, color, margin: 0 }}>{title}</h3>
      <div style={{ fontSize: 7, color: "#444455", marginTop: 4 }}>MagicBlock Private Ephemeral Rollup</div>
    </div>
  );
}

function ClusterToggle({ cluster, onChange, disabled }: {
  cluster: "mainnet" | "devnet";
  onChange: (c: "mainnet" | "devnet") => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 7, color: "#555566", fontFamily: '"Press Start 2P", monospace', flexShrink: 0 }}>NETWORK</span>
      <div style={chamferBox(6, { display: "flex", gap: 0, background: "#0d0d22", border: "1px solid #1a1a3a", overflow: "hidden", opacity: disabled ? 0.45 : 1 })}>
        {(["devnet", "mainnet"] as const).map(c => (
          <ClusterOption key={c} c={c} active={cluster === c} disabled={disabled} onClick={() => !disabled && onChange(c)} />
        ))}
      </div>
    </div>
  );
}

function ClusterOption({ c, active, disabled, onClick }: {
  c: "devnet" | "mainnet"; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick}
      {...feel.handlers}
      style={{
        background: active ? "#c026d322" : "transparent",
        color: active ? "#c026d3" : "#444455",
        border: "none",
        borderRight: c === "devnet" ? "1px solid #1a1a3a" : "none",
        padding: "6px 12px",
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 7,
        cursor: disabled ? "not-allowed" : "pointer",
        textTransform: "uppercase",
        fontWeight: active ? "bold" : "normal",
        ...(disabled ? null : feelStyle(feel)),
      }}
    >
      {c}
    </button>
  );
}

// ── Private payments: the flow as a picture ─────────────────────────────

type PrivateStep = "deposit" | "send" | "withdraw";

const PRIVATE_STEPS: Array<{ id: PrivateStep; num: number; label: string; line: string }> = [
  { id: "deposit",  num: 1, label: "DEPOSIT",  line: "Move USDC from your wallet into your private account." },
  { id: "send",     num: 2, label: "SEND",     line: "Send from the private account. Nobody sees who got what." },
  { id: "withdraw", num: 3, label: "WITHDRAW", line: "Bring USDC back to your wallet anytime." },
];

const PRIVATE_INTRO_KEY = "solcity:private-intro-seen";

/**
 * Wallet -> private account -> friend, with the withdraw loop back underneath.
 * The active step's arrow is lit and a coin travels along it. Each arrow and
 * its label is also the button for that step, so this doubles as the tabs.
 */
function PrivateFlow({ active, onPick, big }: {
  active: PrivateStep; onPick?: (s: PrivateStep) => void; big?: boolean;
}) {
  const F = "#c026d3";
  const paths: Record<PrivateStep, string> = {
    deposit: "M 84 62 L 126 62",
    send: "M 194 62 L 236 62",
    withdraw: "M 160 112 Q 160 134 105 134 Q 50 134 50 112",
  };
  const labelPos: Record<PrivateStep, { x: number; y: number }> = {
    deposit: { x: 105, y: 16 },
    send: { x: 215, y: 16 },
    withdraw: { x: 105, y: 150 },
  };
  // Each node is a character from the city's own sprite sheets (frame 0,
  // facing the camera): you, Magic Man for the private account, a citizen.
  const node = (x: number, label: string, sheet: string, glow: boolean) => (
    <g>
      <polygon points={chamferRectPoints(x - 30, 34, 60, 56, 8)}
        fill={glow ? "#2a0f33" : "#12122a"} stroke={glow ? F : "#2a2a45"} strokeWidth={glow ? 2 : 1} />
      <svg x={x - 26} y={34} width={52} height={56} viewBox="8 2 48 52" overflow="hidden">
        <image href={`/assets/sprites/${sheet}`} width={256} height={256} style={{ imageRendering: "pixelated" }} />
      </svg>
      <text x={x} y={104} textAnchor="middle" fontSize={7} fill={glow ? "#f5d0fe" : "#8b8ba7"}
        fontFamily='"Press Start 2P", monospace'>{label}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 320 160" style={{ width: "100%", height: "auto", display: "block", marginBottom: big ? 4 : 10 }}>
      <defs>
        <marker id="pf-arrow-on" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={F} />
        </marker>
        <marker id="pf-arrow-off" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#3a3a55" />
        </marker>
      </defs>

      {node(50, "YOU", "main_char.png", active === "withdraw")}
      {node(160, "PRIVATE", "Magic Man.png", true)}
      {node(270, "FRIEND", "send-npc.png", active === "send")}

      {PRIVATE_STEPS.map((st) => {
        const on = st.id === active;
        const lp = labelPos[st.id];
        return (
          <g key={st.id} onClick={onPick ? () => onPick(st.id) : undefined} style={{ cursor: onPick ? "pointer" : "default" }}>
            <path d={paths[st.id]} fill="none" stroke="transparent" strokeWidth={22} />
            <path d={paths[st.id]} fill="none" stroke={on ? F : "#3a3a55"} strokeWidth={on ? 3 : 2}
              strokeDasharray={on ? "6 4" : undefined} markerEnd={`url(#pf-arrow-${on ? "on" : "off"})`}>
              {on && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.8s" repeatCount="indefinite" />}
            </path>
            {on && (
              <circle r={5} fill="#FFD700" stroke="#7a5b00" strokeWidth={1}>
                <animateMotion dur="1.4s" repeatCount="indefinite" path={paths[st.id]} />
              </circle>
            )}
            {st.id !== "withdraw" && (
              <line x1={lp.x} y1={lp.y + 5} x2={lp.x} y2={56} stroke={on ? F : "#2a2a45"} strokeWidth={1} />
            )}
            <rect x={lp.x - 34} y={lp.y - 9} width={68} height={14} rx={7}
              fill={on ? F : "#0d0d22"} stroke={on ? F : "#2a2a45"} />
            <text x={lp.x} y={lp.y + 1.5} textAnchor="middle" fontSize={6.5}
              fill={on ? "#fff" : "#8b8ba7"} fontFamily='"Press Start 2P", monospace'>
              {st.num} {st.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** First visit: the three steps as cards, one at a time. */
function PrivateIntro({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = PRIVATE_STEPS[i];
  const last = i === PRIVATE_STEPS.length - 1;
  const F = "#c026d3";
  const backFeel = useButtonFeel();
  const nextFeel = useButtonFeel();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "e" || e.key === "E" || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        if (last) onDone(); else setI((n) => n + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, onDone]);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 8, color: F, margin: 0 }}>HOW PRIVATE TRANSFERS WORK</h3>
        <span style={{ marginLeft: "auto", marginRight: 26, fontSize: 7, color: "#555566" }}>{i + 1}/{PRIVATE_STEPS.length}</span>
      </div>
      <PrivateFlow active={step.id} big />
      <div style={{ textAlign: "center", fontSize: 9, color: "#fff", margin: "6px 0 6px" }}>
        {step.num}. {step.label}
      </div>
      <div style={{ textAlign: "center", fontSize: 8, color: "#b9b9cc", lineHeight: 1.7, minHeight: "3.4em", marginBottom: 12 }}>
        {step.line}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => setI((n) => Math.max(0, n - 1))}
          {...backFeel.handlers}
          style={chamferBox(8, { background: "transparent", border: "1px solid #333344", color: "#888899", padding: "9px 12px", cursor: "pointer", fontFamily: '"Press Start 2P", monospace', fontSize: 7, visibility: i === 0 ? "hidden" : "visible", ...feelStyle(backFeel) })}
        >
          BACK
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 5 }}>
          {PRIVATE_STEPS.map((s, n) => (
            <span key={s.id} style={{ width: n === i ? 16 : 6, height: 6, background: n === i ? F : "#333344", transition: "width .2s" }} />
          ))}
        </div>
        <button onClick={() => (last ? onDone() : setI((n) => n + 1))} {...nextFeel.handlers} style={btnStyle(F, "#fff", nextFeel)} className="px-4 py-2.5">
          {last ? "START" : "NEXT"}
        </button>
      </div>
    </>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────

const TOKEN_LIST_SYMBOLS = ["SOL", "USDC", "USDT", "JUP", "BONK"];

function TokenBox({ label, token, onTokenChange, excludeToken, tokens, getLogo, children }: {
  label: string;
  token: string;
  onTokenChange: (t: string) => void;
  excludeToken: string;
  tokens: string[];
  getLogo: (s: string) => string;
  children: React.ReactNode;
}) {
  const logo = getLogo(token);
  return (
    <div style={chamferBox(8, { background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", padding: 12, marginBottom: 8 })}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: "8px", color: "#555566" }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {logo && <img src={logo} alt={token} style={{ width: 18, height: 18, borderRadius: "50%" }} />}
          <select value={token} onChange={(e) => onTokenChange(e.target.value)}
            style={chamferBox(4, { background: "#1a1a3a", color: "#B7E928", border: "1px solid rgba(183,233,40,0.2)", padding: "2px 6px", fontSize: "9px", cursor: "pointer", outline: "none" })}>
            {tokens.filter(t => t !== excludeToken).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      {children}
    </div>
  );
}

function InputBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={chamferBox(8, { background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", padding: 12, marginBottom: 8 })}>
      <div style={{ fontSize: "8px", color: "#555566", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function StepCard({ number, title, description, color, action }: {
  number: number; title: string; description: string; color: string; action?: React.ReactNode;
}) {
  return (
    <div style={chamferBox(8, { display: "flex", gap: 12, background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", padding: 12 })}>
      <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: `${color}22`, border: `1px solid ${color}44`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: "bold" }}>
        {number}
      </div>
      <div>
        <div style={{ color: "#ccccdd", fontWeight: "bold", fontSize: "10px", marginBottom: 3 }}>{title}</div>
        <div style={{ color: "#777788", fontSize: "8px", lineHeight: 1.5 }}>{description}</div>
        {action}
      </div>
    </div>
  );
}

function btnStyle(bg: string, color = "#fff", feel?: Pick<ButtonFeel, "hover" | "pressed">): React.CSSProperties {
  return chamferBox(8, {
    background: bg,
    color,
    border: "none",
    cursor: "pointer",
    fontFamily: '"Press Start 2P", monospace',
    fontSize: "7px",
    display: "block",
    textAlign: "center",
    ...(feel ? feelStyle(feel) : null),
  });
}
