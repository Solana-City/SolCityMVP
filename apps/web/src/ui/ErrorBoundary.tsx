"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * ErrorBoundary
 *
 * Catches any unhandled React render/lifecycle errors and shows a clean
 * recovery screen instead of a blank white page. Critical for Seeker where
 * users have no DevTools to diagnose a silent crash.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidMount() {
    // Catch errors that escape React's lifecycle (useEffect uncaught throws,
    // WebGL context-loss events, Phaser internal exceptions) so the user sees
    // a recovery screen instead of a blank/frozen page.
    //
    // IMPORTANT: wallet adapter errors (network mismatch, user rejection) are
    // caught by WalletSignBridge's try/catch and should NOT reach here. Only
    // escalate errors that originate from Phaser or core game logic.
    this._onError = (event: ErrorEvent) => {
      // Ignore wallet adapter / RPC errors — these are handled in-game.
      const msg = event.message ?? "";
      if (
        msg.includes("User rejected") ||
        msg.includes("WalletSendTransactionError") ||
        msg.includes("Transaction simulation failed") ||
        msg.includes("Blockhash not found") ||
        msg.includes("session offline") ||
        // Tweetnacl assertion from web3.js getSignatureStatus with invalid sig
        (msg === "Assertion failed")
      ) {
        console.warn("[ErrorBoundary] suppressed wallet error:", msg);
        return;
      }
      const err = event.error ?? new Error(msg);
      // Attach source for debugging
      (err as any)._source = `${event.filename}:${event.lineno}`;
      this.setState({ error: err });
    };
    this._onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
      const msg = err.message ?? "";
      // Ignore known wallet / RPC rejections that are recoverable.
      if (
        msg.includes("User rejected") ||
        msg.includes("WalletSendTransactionError") ||
        msg.includes("Transaction simulation failed") ||
        msg.includes("Blockhash not found") ||
        msg.includes("wallet sign timeout") ||
        msg.includes("Wallet not connected") ||
        msg.includes("session offline") ||
        msg === "Assertion failed"
      ) {
        console.warn("[ErrorBoundary] suppressed wallet rejection:", msg);
        return;
      }
      this.setState({ error: err });
    };
    window.addEventListener("error", this._onError);
    window.addEventListener("unhandledrejection", this._onUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this._onError!);
    window.removeEventListener("unhandledrejection", this._onUnhandledRejection!);
  }

  private _onError?: (e: ErrorEvent) => void;
  private _onUnhandledRejection?: (e: PromiseRejectionEvent) => void;

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[SolCity] Uncaught error:", error, info.componentStack);
  }

  handleReload = () => {
    // Clear any stale state that might cause a reload loop
    try { sessionStorage.clear(); } catch {}
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#06080e",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          padding: 32,
          fontFamily: '"Fira Code", monospace',
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 52 }}>⚠️</div>

        <div>
          <div
            style={{
              color: "#ff5555",
              fontSize: 18,
              fontWeight: "bold",
              marginBottom: 8,
            }}
          >
            Something went wrong
          </div>
          <div style={{ color: "#444466", fontSize: 12, maxWidth: 360, lineHeight: 1.6 }}>
            {error.message || "An unexpected error occurred."}
          </div>
          {error.stack && (
            <pre style={{
              color: "#333355", fontSize: 9, maxWidth: 420, maxHeight: 120,
              overflow: "auto", textAlign: "left", whiteSpace: "pre-wrap",
              background: "rgba(255,255,255,0.03)", borderRadius: 6,
              padding: "6px 8px", margin: 0, lineHeight: 1.5,
            }}>
              {error.stack.slice(0, 600)}
            </pre>
          )}
        </div>

        <button
          onClick={this.handleReload}
          style={{
            padding: "12px 28px",
            borderRadius: 10,
            background: "rgba(153,69,255,0.15)",
            border: "1px solid rgba(153,69,255,0.5)",
            color: "#9945FF",
            fontSize: 13,
            fontWeight: "bold",
            fontFamily: '"Fira Code", monospace',
            cursor: "pointer",
          }}
        >
          Reload game
        </button>

        <div style={{ color: "#222244", fontSize: 10 }}>
          If the problem persists, try clearing your browser cache.
        </div>
      </div>
    );
  }
}
