"use client";

export default function OfflinePage() {
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
      <div style={{ fontSize: 56 }}>📡</div>

      <div>
        <div
          style={{
            color: "#9945FF",
            fontSize: 20,
            fontWeight: "bold",
            marginBottom: 10,
            letterSpacing: -0.3,
          }}
        >
          You&apos;re offline
        </div>
        <div
          style={{
            color: "#444466",
            fontSize: 13,
            lineHeight: 1.7,
            maxWidth: 300,
          }}
        >
          Sol City requires a connection to the Solana network.
          <br />
          Check your internet and try again.
        </div>
      </div>

      <div
        style={{
          width: 48,
          height: 3,
          borderRadius: 2,
          background: "linear-gradient(90deg, #9945FF, #14F195)",
        }}
      />

      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "11px 28px",
          borderRadius: 10,
          background: "rgba(153,69,255,0.12)",
          border: "1px solid rgba(153,69,255,0.4)",
          color: "#9945FF",
          fontSize: 13,
          fontWeight: "bold",
          fontFamily: '"Fira Code", monospace',
          cursor: "pointer",
        }}
      >
        Retry
      </button>
    </div>
  );
}
