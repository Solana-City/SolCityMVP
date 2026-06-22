"use client";

import { useState } from "react";
import { baseExplorerTxUrl, type LogEntry, type LogLayer } from "./useJokenpoMachine";

const LAYER_META: Record<LogLayer, { label: string; color: string; icon: string }> = {
  base: { label: "PUBLIC", color: "#9945FF", icon: "🌐" },
  tee: { label: "PRIVATE", color: "#14F195", icon: "🔒" },
  settle: { label: "SETTLE", color: "#FFD700", icon: "💰" },
};

/**
 * Every on-chain step this match has taken, in order — the "show your
 * work" panel. PRIVATE entries are real signed transactions you can open
 * in an explorer same as any other; the data inside them just isn't
 * readable until the matching PUBLIC reveal step flips it open. That's
 * the whole transparency story in one place.
 */
export default function OnchainLog({ log }: { log: LogEntry[] }) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div
      style={{
        marginTop: 4,
        borderTop: "1px solid rgba(153,69,255,0.1)",
        paddingTop: 10,
      }}
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          color: "#6060aa",
        }}
      >
        <span style={{ fontSize: 11 }}>📜</span>
        <span style={{ fontSize: 11, flex: 1, textAlign: "left" }}>
          On-chain log {log.length > 0 && `(${log.length})`}
        </span>
        <span className="jokenpo-log-collapse" style={{ fontSize: 10, transition: "color 0.15s ease" }}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
        <div
          style={{
            marginTop: 8,
            maxHeight: 180,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            paddingRight: 2,
          }}
        >
          {log.length === 0 ? (
            <div style={{ fontSize: 10, color: "#3a3a5a", textAlign: "center", padding: "6px 0" }}>
              Nothing yet.
            </div>
          ) : (
            log.map((entry) => {
              const meta = LAYER_META[entry.layer];
              return (
                <div
                  key={entry.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 10,
                    opacity: entry.status === "pending" ? 0.6 : 1,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 8,
                      padding: "2px 5px",
                      borderRadius: 4,
                      border: `1px solid ${meta.color}55`,
                      color: meta.color,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {meta.icon} {meta.label}
                  </span>
                  <span style={{ flex: 1, color: "#9090cc", lineHeight: 1.3 }}>{entry.text}</span>
                  <span style={{ flexShrink: 0 }}>
                    {entry.status === "pending" && "⏳"}
                    {entry.status === "err" && <span style={{ color: "#ff6b6b" }}>✗</span>}
                    {entry.status === "ok" && entry.sig && (
                      <a
                        href={baseExplorerTxUrl(entry.sig)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#14F195", textDecoration: "none" }}
                        title={entry.sig}
                      >
                        ✓ view
                      </a>
                    )}
                    {entry.status === "ok" && !entry.sig && <span style={{ color: "#14F195" }}>✓</span>}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
