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
          <div style={{ color: "#444466", fontSize: 12, maxWidth: 320, lineHeight: 1.6 }}>
            {error.message || "An unexpected error occurred."}
          </div>
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
