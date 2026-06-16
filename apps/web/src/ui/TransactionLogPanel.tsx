"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  transactionLog,
  getExplorerUrl,
  type TxEntry,
  type TxKind,
  type TxLayer,
  type TxStatus,
} from "@/game/telemetry/transactionLog";

interface Props {
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * Live on-chain activity console. Renders as a floating button in the
 * top-right HUD; expands into a panel anchored just below the button.
 *
 * Design notes:
 *   - The button exposes a live pending counter so the player sees
 *     activity even when the panel is closed.
 *   - Move entries are pre-coalesced by the log service, but at very
 *     high throughput we still re-render at ~4 Hz max via RAF-throttled
 *     state updates to protect the main thread.
 *   - Filter chips are layered: kind AND status. This lets the player
 *     isolate "failed swaps" or "all moves in the last minute" quickly.
 */
export default function TransactionLogPanel({ isOpen, onToggle }: Props) {
  const [entries, setEntries] = useState<ReadonlyArray<TxEntry>>([]);
  const [kindFilter, setKindFilter] = useState<TxKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<TxStatus | "all">("all");

  // Subscribe to log updates with throttled re-renders. We receive the
  // snapshot immediately and then coalesce further updates into animation
  // frames to avoid layout thrash under 10 Hz move traffic.
  useEffect(() => {
    let rafId: number | null = null;
    let pending: ReadonlyArray<TxEntry> | null = null;

    const flush = () => {
      if (pending) {
        setEntries(pending);
        pending = null;
      }
      rafId = null;
    };

    const unsubscribe = transactionLog.subscribe((snapshot) => {
      pending = snapshot;
      if (rafId === null) {
        rafId = requestAnimationFrame(flush);
      }
    });

    return () => {
      unsubscribe();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Hotkey: T toggles the panel, unless typing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "t" && e.key !== "T") return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
        return;
      }
      e.preventDefault();
      onToggle();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToggle]);

  const pendingCount = useMemo(
    () => entries.filter((e) => e.status === "pending").length,
    [entries]
  );
  const failedCount = useMemo(
    () => entries.filter((e) => e.status === "failed").length,
    [entries]
  );

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      return true;
    });
  }, [entries, kindFilter, statusFilter]);

  const triggerRef = useRef<HTMLDivElement>(null);

  // Compute panel top dynamically so it always opens just below the HUD card,
  // regardless of how tall the card grows.
  const panelTop = (() => {
    if (!triggerRef.current) return 130;
    const rect = triggerRef.current.getBoundingClientRect();
    return rect.bottom + 6;
  })();

  return (
    <>
      <div ref={triggerRef} style={{ display: "contents" }}>
        <ToggleButton
          isOpen={isOpen}
          onClick={onToggle}
          entryCount={entries.length}
          pendingCount={pendingCount}
          failedCount={failedCount}
        />
      </div>
      {isOpen && (
        <div
          className="fixed z-30 rounded-xl overflow-hidden flex flex-col"
          style={{
            top: panelTop,
            right: 16,
            width: 420,
            maxWidth: "calc(100vw - 32px)",
            height: `min(560px, calc(100vh - ${panelTop + 8}px))`,
            background: "rgba(10,10,30,0.97)",
            border: "1px solid rgba(153,69,255,0.35)",
            backdropFilter: "blur(4px)",
            fontFamily: '"Fira Code", monospace',
          }}
        >
          <Header
            total={entries.length}
            pending={pendingCount}
            failed={failedCount}
            onClear={() => transactionLog.clear()}
            onClose={onToggle}
          />
          <Filters
            kindFilter={kindFilter}
            setKindFilter={setKindFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
          />
          <EntryList entries={filtered} />
        </div>
      )}
    </>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────

function ToggleButton({
  isOpen,
  onClick,
  entryCount,
  pendingCount,
  failedCount,
}: {
  isOpen: boolean;
  onClick: () => void;
  entryCount: number;
  pendingCount: number;
  failedCount: number;
}) {
  // Border color leans on activity: failing stands out loudest.
  const borderColor =
    failedCount > 0 ? "#F72585" : pendingCount > 0 ? "#FFD700" : "#14F195";

  return (
    <button
      onClick={onClick}
      title="On-chain activity [T]"
      className="rounded-lg cursor-pointer transition-colors flex items-center gap-2 px-3"
      style={{
        height: 32,
        background: isOpen ? "rgba(153,69,255,0.2)" : "rgba(10,10,30,0.85)",
        border: `1.5px solid ${borderColor}`,
        color: "#ccccdd",
        fontFamily: '"Press Start 2P", monospace',
        fontSize: "8px",
      }}
    >
      <PulseDot color={borderColor} active={pendingCount > 0} />
      <span>ON-CHAIN</span>
      <span style={{ color: "#666677" }}>·</span>
      <span style={{ color: borderColor }}>{entryCount}</span>
    </button>
  );
}

function PulseDot({ color, active }: { color: string; active: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        boxShadow: active ? `0 0 6px ${color}` : "none",
        animation: active ? "pulse 1s ease-in-out infinite" : "none",
      }}
    />
  );
}

function Header({
  total,
  pending,
  failed,
  onClear,
  onClose,
}: {
  total: number;
  pending: number;
  failed: number;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
      style={{ borderBottom: "1px solid rgba(153,69,255,0.15)" }}
    >
      <div
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "10px",
          color: "#9945FF",
          letterSpacing: "0.05em",
        }}
      >
        ON-CHAIN LOG
      </div>
      <div className="flex gap-2 text-xs" style={{ color: "#777788" }}>
        <span>{total} total</span>
        {pending > 0 && <span style={{ color: "#FFD700" }}>· {pending} pending</span>}
        {failed > 0 && <span style={{ color: "#F72585" }}>· {failed} failed</span>}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <button
          onClick={onClear}
          className="cursor-pointer text-xs"
          style={{
            background: "none",
            border: "none",
            color: "#555566",
            textDecoration: "underline",
          }}
          title="Clear log"
        >
          clear
        </button>
        <button
          onClick={onClose}
          className="cursor-pointer text-lg leading-none"
          style={{ background: "none", border: "none", color: "#555566" }}
          aria-label="Close log"
        >
          ×
        </button>
      </div>
    </div>
  );
}

const KIND_OPTIONS: Array<{ value: TxKind | "all"; label: string }> = [
  { value: "all", label: "all" },
  { value: "move", label: "move" },
  { value: "swap", label: "swap" },
  { value: "transfer", label: "send" },
  { value: "delegate", label: "delegate" },
  { value: "init", label: "init" },
  { value: "bounty", label: "bounty" },
];

const STATUS_OPTIONS: Array<{ value: TxStatus | "all"; label: string; color: string }> = [
  { value: "all", label: "all", color: "#777788" },
  { value: "confirmed", label: "confirmed", color: "#14F195" },
  { value: "pending", label: "pending", color: "#FFD700" },
  { value: "failed", label: "failed", color: "#F72585" },
];

function Filters({
  kindFilter,
  setKindFilter,
  statusFilter,
  setStatusFilter,
}: {
  kindFilter: TxKind | "all";
  setKindFilter: (v: TxKind | "all") => void;
  statusFilter: TxStatus | "all";
  setStatusFilter: (v: TxStatus | "all") => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 px-4 py-2 flex-shrink-0"
      style={{ borderBottom: "1px solid rgba(153,69,255,0.15)" }}
    >
      <FilterRow label="kind">
        {KIND_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.value}
            active={kindFilter === opt.value}
            onClick={() => setKindFilter(opt.value)}
          >
            {opt.label}
          </FilterChip>
        ))}
      </FilterRow>
      <FilterRow label="status">
        {STATUS_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.value}
            active={statusFilter === opt.value}
            onClick={() => setStatusFilter(opt.value)}
            color={opt.color}
          >
            {opt.label}
          </FilterChip>
        ))}
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs" style={{ color: "#555566", width: 40 }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  color = "#9945FF",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer transition-colors"
      style={{
        padding: "2px 8px",
        fontSize: "10px",
        borderRadius: 4,
        background: active ? `${color}22` : "transparent",
        border: `1px solid ${active ? color : "rgba(153,69,255,0.2)"}`,
        color: active ? color : "#888899",
      }}
    >
      {children}
    </button>
  );
}

function EntryList({ entries }: { entries: ReadonlyArray<TxEntry> }) {
  if (entries.length === 0) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-sm"
        style={{ color: "#444455", padding: "24px" }}
      >
        No transactions yet. Move around or interact with an NPC.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function EntryRow({ entry }: { entry: TxEntry }) {
  const explorerUrl = getExplorerUrl(entry);
  const isSimulated = entry.signature?.startsWith("sim:");
  const statusColor =
    entry.status === "confirmed"
      ? "#14F195"
      : entry.status === "pending"
      ? "#FFD700"
      : "#F72585";
  const layerColor =
    entry.layer === "ephemeral"
      ? "#9945FF"
      : entry.layer === "jupiter"
      ? "#FFD700"
      : entry.layer === "base"
      ? "#00D1FF"
      : "#555566";

  return (
    <div
      className="px-4 py-2 flex items-start gap-3 hover:bg-[rgba(153,69,255,0.05)] transition-colors"
      style={{ borderBottom: "1px solid rgba(153,69,255,0.08)" }}
    >
      <PulseDot color={statusColor} active={entry.status === "pending"} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span style={{ color: "#ccccdd" }}>{entry.label}</span>
          {entry.batchCount && entry.batchCount > 1 && (
            <span
              style={{
                fontSize: "9px",
                color: "#9945FF",
                background: "rgba(153,69,255,0.12)",
                padding: "1px 4px",
                borderRadius: 3,
              }}
            >
              ×{entry.batchCount}
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-2 mt-1"
          style={{ fontSize: "9px", color: "#666677" }}
        >
          <span style={{ color: layerColor }}>{entry.layer}</span>
          <span>·</span>
          <span>{formatRelativeTime(entry.updatedAt)}</span>
          {entry.signature && !isSimulated && (
            <>
              <span>·</span>
              <span title={entry.signature}>
                {entry.signature.slice(0, 6)}…{entry.signature.slice(-4)}
              </span>
            </>
          )}
          {isSimulated && (
            <>
              <span>·</span>
              <span style={{ color: "#555566", fontStyle: "italic" }}>simulation</span>
            </>
          )}
        </div>
        {entry.error && (
          <div className="mt-1" style={{ fontSize: "10px", color: "#F72585" }}>
            {entry.error}
          </div>
        )}
      </div>
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs flex-shrink-0"
          style={{
            color: layerColor,
            textDecoration: "none",
            padding: "2px 6px",
            border: `1px solid ${layerColor}55`,
            borderRadius: 4,
          }}
          title="View on explorer"
        >
          ↗
        </a>
      )}
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 1000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}
