"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  suppressedCount: number;
}

/** Messages that indicate a wallet / EVM extension error (non-fatal). */
function isWalletError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("failed to connect") ||
    lower.includes("user rejected") ||
    lower.includes("transaction simulation failed") ||
    lower.includes("blockhash not found") ||
    lower.includes("session offline") ||
    lower.includes("metamask") ||
    lower.includes("walletconnect") ||
    msg === "Assertion failed"
    // NOTE: do NOT add generic "wallet" — too broad, masks real game errors
  );
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
    this.state = { error: null, suppressedCount: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    // IMPORTANT: never return { error: null } here — React would re-render
    // children, they'd throw again, causing an infinite loop. Always store
    // the error; the render method decides whether to show it.
    return { error, suppressedCount: 0 };
  }

  componentDidMount() {
    // Catch errors that escape React's lifecycle (useEffect uncaught throws,
    // WebGL context-loss events, Phaser internal exceptions).
    this._onError = (event: ErrorEvent) => {
      const msg = event.message ?? "";
      if (isWalletError(msg)) {
        console.warn("[ErrorBoundary] suppressed error:", msg);
        return;
      }
      const err = event.error ?? new Error(msg);
      (err as any)._source = `${event.filename}:${event.lineno}`;
      this.setState({ error: err, suppressedCount: 0 });
    };
    this._onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
      if (isWalletError(err.message ?? "")) {
        console.warn("[ErrorBoundary] suppressed rejection:", err.message);
        return;
      }
      this.setState({ error: err, suppressedCount: 0 });
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
    try { sessionStorage.clear(); } catch {}
    window.location.reload();
  };

  render() {
    const { error } = this.state;

    // Wallet / EVM errors caught by getDerivedStateFromError: show a softer
    // message that auto-reloads instead of blocking the game.
    if (error && isWalletError(error.message ?? "")) {
      console.warn("[ErrorBoundary] wallet render error — auto-reloading:", error.message);
      // Reload after a brief delay so the user sees something happened
      setTimeout(() => { try { window.location.reload(); } catch {} }, 1500);
      return null; // blank screen for 1.5s then reload
    }

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
