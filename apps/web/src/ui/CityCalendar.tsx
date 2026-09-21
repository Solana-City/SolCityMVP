"use client";

/**
 * A month calendar of what matters in the Solana world and in the city:
 * Superteam bounty deadlines, hackathon deadlines, and the city's own events
 * (game/daily/calendar.ts, which can span several days).
 *
 * Coloured dots mark the days; tapping a day lists what happens on it, and
 * an empty day shows what comes next instead of a blank.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchEarnListings, type EarnListing } from "@/game/solana/superteamEarn";
import { CITY_EVENTS } from "@/game/daily/calendar";

const PIXEL = '"Press Start 2P", monospace';

const KIND = {
  city: { color: "#14F195", label: "CITY" },
  hackathon: { color: "#c084fc", label: "HACKATHON" },
  bounty: { color: "#FFD700", label: "BOUNTY" },
} as const;
type Kind = keyof typeof KIND;

interface Entry {
  day: string;
  kind: Kind;
  title: string;
  /** Short context under the title: "ends", a reward, a count. */
  note?: string;
  url?: string;
}

function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d);
}

function reward(l: EarnListing): string | undefined {
  return l.rewardAmount ? `${l.rewardAmount.toLocaleString("en-US")} ${l.token}` : undefined;
}

/** Everything that lands on a date, plus the in-between days of ranges. */
export function buildEntries(bounties: EarnListing[], hackathons: EarnListing[]): { entries: Entry[]; spans: Set<string> } {
  const entries: Entry[] = [];
  const spans = new Set<string>();

  for (const e of CITY_EVENTS) {
    if (e.end && e.end > e.date) {
      entries.push({ day: e.date, kind: "city", title: e.title, note: "starts", url: e.url });
      entries.push({ day: e.end, kind: "city", title: e.title, note: "ends", url: e.url });
      for (let d = addDays(e.date, 1); d < e.end; d = addDays(d, 1)) spans.add(d);
    } else {
      entries.push({ day: e.date, kind: "city", title: e.title, url: e.url });
    }
  }

  for (const b of bounties) {
    if (!b.deadline) continue;
    entries.push({ day: b.deadline.slice(0, 10), kind: "bounty", title: b.title, note: `ends${reward(b) ? ` · ${reward(b)}` : ""}`, url: b.url });
  }

  // A hackathon arrives as many tracks sharing one deadline: one entry per
  // day, not twenty identical rows.
  const byDay = new Map<string, EarnListing[]>();
  for (const h of hackathons) {
    if (!h.deadline) continue;
    const day = h.deadline.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), h]);
  }
  for (const [day, tracks] of byDay) {
    entries.push(tracks.length === 1
      ? { day, kind: "hackathon", title: tracks[0].title, note: "submissions close", url: tracks[0].url }
      : { day, kind: "hackathon", title: `${tracks.length} hackathon tracks`, note: "submissions close", url: tracks[0].url });
  }

  entries.sort((a, b) => a.day.localeCompare(b.day));
  return { entries, spans };
}

export default function CityCalendar() {
  const today = utcDay();
  const [bounties, setBounties] = useState<EarnListing[]>([]);
  const [hackathons, setHackathons] = useState<EarnListing[]>([]);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState(today);

  useEffect(() => {
    let cancelled = false;
    fetchEarnListings("bounty", 20).then((b) => { if (!cancelled) setBounties(b); });
    fetchEarnListings("hackathon", 20).then((h) => { if (!cancelled) setHackathons(h); });
    return () => { cancelled = true; };
  }, []);

  const { entries, spans } = useMemo(() => buildEntries(bounties, hackathons), [bounties, hackathons]);
  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) m.set(e.day, [...(m.get(e.day) ?? []), e]);
    return m;
  }, [entries]);

  // The visible month, as a grid starting on Sunday.
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: first.getUTCDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => utcDay(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i + 1)))),
  ];

  const onDay = byDay.get(selected) ?? [];
  const next = onDay.length === 0 ? entries.filter((e) => e.day > selected).slice(0, 3) : [];

  return (
    <div>
      {/* Month header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <NavButton disabled={monthOffset <= -1} onClick={() => setMonthOffset((n) => n - 1)}>‹</NavButton>
        <div style={{ flex: 1, textAlign: "center", fontFamily: PIXEL, fontSize: 7, color: "#e2e8f0" }}>{monthLabel}</div>
        <NavButton disabled={monthOffset >= 3} onClick={() => setMonthOffset((n) => n + 1)}>›</NavButton>
      </div>

      {/* Weekdays */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontFamily: PIXEL, fontSize: 6, color: "#475569" }}>{d}</div>
        ))}
      </div>

      {/* Days */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />;
          const list = byDay.get(day) ?? [];
          const kinds = [...new Set(list.map((e) => e.kind))];
          const isToday = day === today;
          const isSelected = day === selected;
          const past = day < today;
          return (
            <button
              key={day}
              onClick={() => setSelected(day)}
              style={{
                aspectRatio: "1", borderRadius: 5, padding: 0, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                background: isSelected ? "rgba(153,69,255,0.35)" : spans.has(day) ? "rgba(20,241,149,0.1)" : "#0d0d22",
                border: isToday ? "1px solid #fff" : "1px solid rgba(255,255,255,0.05)",
                opacity: past ? 0.45 : 1,
              }}
            >
              <span style={{ fontFamily: PIXEL, fontSize: 7, color: isToday ? "#fff" : "#cbd5e1" }}>
                {Number(day.slice(8))}
              </span>
              <span style={{ display: "flex", gap: 2, height: 4 }}>
                {kinds.map((k) => (
                  <span key={k} style={{ width: 4, height: 4, borderRadius: "50%", background: KIND[k].color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "8px 0" }}>
        {(Object.keys(KIND) as Kind[]).map((k) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: PIXEL, fontSize: 5, color: "#64748b" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: KIND[k].color }} />
            {KIND[k].label}
          </span>
        ))}
      </div>

      {/* The selected day */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
        <div style={{ fontFamily: PIXEL, fontSize: 6, color: "#64748b", marginBottom: 6 }}>
          {selected === today ? "TODAY" : new Date(`${selected}T00:00:00Z`).toLocaleDateString("en-US", {
            weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
          }).toUpperCase()}
        </div>
        {onDay.map((e, i) => <Row key={i} entry={e} />)}
        {onDay.length === 0 && (
          <>
            <div style={{ fontFamily: PIXEL, fontSize: 6, color: "#475569", marginBottom: next.length ? 6 : 0 }}>
              {next.length ? "NOTHING ON THIS DAY. NEXT UP:" : "NOTHING SCHEDULED YET."}
            </div>
            {next.map((e, i) => <Row key={i} entry={e} showDate />)}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ entry, showDate }: { entry: Entry; showDate?: boolean }) {
  const body = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 7, margin: "5px 0" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: KIND[entry.kind].color, marginTop: 2, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: PIXEL, fontSize: 7, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.title}
        </div>
        <div style={{ fontFamily: PIXEL, fontSize: 6, color: "#64748b", marginTop: 3 }}>
          {showDate && `${new Date(`${entry.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase()} · `}
          {KIND[entry.kind].label}{entry.note ? ` · ${entry.note}` : ""}
        </div>
      </div>
    </div>
  );
  return entry.url
    ? <a href={entry.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block" }}>{body}</a>
    : body;
}

function NavButton({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 24, height: 22, borderRadius: 5, border: "1px solid rgba(255,255,255,0.08)",
        background: "#0d0d22", color: disabled ? "#334155" : "#cbd5e1", cursor: disabled ? "default" : "pointer",
        fontSize: 14, lineHeight: 1, padding: 0,
      }}
    >
      {children}
    </button>
  );
}
