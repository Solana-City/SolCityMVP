"use client";

/**
 * The city calendar: what is happening in Solana City and around Solana.
 *
 * The calendar leads (bounty and hackathon deadlines, the city's own events),
 * then who is leading the city and who is online. Everything on it updates by
 * itself; nothing waits on someone to post. Your own progress (streak, quests,
 * achievements) lives in the profile instead, so the two never repeat.
 *
 * Opens on the first visit of each UTC day and from the calendar shortcut on
 * the map card. The component is always mounted: it also does the daily
 * check-in, signed with the session key, whether or not the panel is shown.
 */
import { useCallback, useEffect, useState } from "react";
import nacl from "tweetnacl";
import { useWallet } from "@solana/wallet-adapter-react";
import type { OnChainMultiplayer, OnChainPlayer } from "@/game/multiplayer/OnChainMultiplayer";
import { checkinMessage } from "@/lib/checkinMessage";
import { fetchBoard, type BoardRow } from "@/game/leaderboards/boards";
import { fetchLeaderboard, type LeaderboardEntry } from "@/game/solana/leaderboard";
import { OPEN_CALENDAR_EVENT, STREAK_EVENT, type StreakView } from "@/game/daily/calendarEvents";
import { profileManager } from "@/game/config/profileManager";
import { useNicknames } from "./useNicknames";
import { Citizen, Img, guideSeen } from "./CityGuide";
import CityCalendar from "./CityCalendar";

export { OPEN_CALENDAR_EVENT, STREAK_EVENT };

const PIXEL = '"Press Start 2P", monospace';
const GREEN = "#14F195";
const GOLD = "#FFD700";
const UI = "/assets/ui";
const SEEN_KEY = "solcity:calendar-seen";
const RANK_ROWS = 5;

function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function seenToday(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === utcDay(); } catch { return true; }
}

function markSeenToday(): void {
  try { localStorage.setItem(SEEN_KEY, utcDay()); } catch { /* storage blocked */ }
}

function short(wallet: string): string {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

function publishStreak(streak: StreakView): void {
  profileManager.setStreakBest(streak.best);
  window.dispatchEvent(new CustomEvent(STREAK_EVENT, { detail: streak }));
}

export default function CalendarPanel({ gameRef }: { gameRef: Phaser.Game | null }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [open, setOpen] = useState(false);
  const [streak, setStreak] = useState<StreakView | null>(null);
  const [leaders, setLeaders] = useState<{ kite?: BoardRow; hunt?: BoardRow; streak?: BoardRow }>({});
  const [rankTab, setRankTab] = useState<"online" | "alltime">("online");
  const [online, setOnline] = useState<OnChainPlayer[]>([]);
  const [allTime, setAllTime] = useState<LeaderboardEntry[] | null>(null);
  const layout = useLayout();

  // ── Daily check-in: signed with the session key, retried while the key is
  // still being authorized on-chain in the first seconds after connecting.
  useEffect(() => {
    if (!gameRef || !wallet) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const got = (s: StreakView) => { if (!cancelled) { setStreak(s); publishStreak(s); } };

    const attempt = async () => {
      if (cancelled) return;
      const net = gameRef.scene.getScene("CityScene")?.registry.get("network") as OnChainMultiplayer | undefined;
      if (net) {
        try {
          const kp = net.getSessionKeys().getSessionKey();
          const ts = Date.now();
          const sig = nacl.sign.detached(new TextEncoder().encode(checkinMessage(wallet, ts)), kp.secretKey);
          const res = await fetch("/api/checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wallet, sessionKey: kp.publicKey.toBase58(), ts,
              signature: btoa(String.fromCharCode(...sig)),
            }),
          });
          const body = await res.json();
          if (body.ok && body.streak) { got(body.streak); return; }
          if (!body.retry) return; // store off or a hard failure: stop quietly
        } catch { /* network blip: retry */ }
      }
      if (++attempts < 24) timer = setTimeout(attempt, 5_000);
    };

    // Show the stored streak straight away; the check-in updates it.
    fetch(`/api/checkin?wallet=${wallet}`)
      .then((r) => r.json())
      .then((b) => { if (b.streak) got(b.streak); })
      .catch(() => undefined);
    void attempt();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [gameRef, wallet]);

  // ── Opening: once per UTC day on entering the city, never on the very
  // first visit (Sol's guide owns that one), and from the map card shortcut.
  const [firstVisit] = useState(() => !guideSeen());
  useEffect(() => {
    const onEnter = () => {
      if (firstVisit || seenToday()) return;
      window.setTimeout(() => setOpen(true), 1_200);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("solcity:entered-city", onEnter);
    window.addEventListener(OPEN_CALENDAR_EVENT, onOpen);
    return () => {
      window.removeEventListener("solcity:entered-city", onEnter);
      window.removeEventListener(OPEN_CALENDAR_EVENT, onOpen);
    };
  }, [firstVisit]);

  // ── Content, loaded while the panel is open.
  useEffect(() => {
    if (!open) return;
    markSeenToday();
    let cancelled = false;
    Promise.all([
      fetchBoard("game:kite-clash", { limit: 1 }),
      fetchBoard("hunt", { limit: 1 }),
      fetchBoard("streak", { limit: 1 }),
    ]).then(([kite, hunt, st]) => {
      if (!cancelled) setLeaders({ kite: kite.rows[0], hunt: hunt.rows[0], streak: st.rows[0] });
    }).catch(() => undefined);

    const readOnline = () => {
      const net = gameRef?.scene.getScene("CityScene")?.registry.get("network") as
        { getActivePlayers?: () => OnChainPlayer[] } | undefined;
      if (net?.getActivePlayers) setOnline(net.getActivePlayers());
    };
    readOnline();
    const poll = setInterval(readOnline, 2_000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [open, gameRef]);

  useEffect(() => {
    if (!open || rankTab !== "alltime" || allTime) return;
    fetchLeaderboard().then(setAllTime).catch(() => setAllTime([]));
  }, [open, rankTab, allTime]);

  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // The ranking, as rows the same shape for both tabs.
  const rows = rankTab === "online"
    ? [...online].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((p) => ({ wallet: p.wallet, fallback: p.displayName, score: p.score ?? 0 }))
    : (allTime ?? []).map((e) => ({ wallet: e.wallet, fallback: e.displayName, score: e.score }));
  const names = useNicknames(rows.slice(0, 50).map((r) => r.wallet));

  if (!open) return null;

  const today = new Date();
  const myIndex = wallet ? rows.findIndex((r) => r.wallet === wallet) : -1;

  return (
    <div
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(4,6,14,0.62)", padding: 8,
      }}
    >
      <div
        className="tc-in"
        style={{
          width: layout.wide ? "min(780px, 100%)" : "min(420px, 100%)",
          // Sized to fit without scrolling; the scroll is only a safety net
          // for screens smaller than anything we design for.
          maxHeight: "96vh", overflowY: "auto",
          background: "linear-gradient(180deg, #14142e 0%, #0b0b1c 100%)",
          border: "1px solid rgba(153,69,255,0.45)", borderRadius: 12, padding: layout.short ? 8 : 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)", fontFamily: PIXEL, color: "#e2e8f0",
        }}
      >
        {/* Header, with today's check-in as the first thing you see */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: layout.short ? 6 : 10 }}>
          <Citizen sheet="Sol.png" size={layout.short ? 22 : 28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 8, color: GREEN }}>CITY CALENDAR</div>
            <div style={{ fontSize: 6, color: "#64748b", marginTop: 4 }}>
              {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).toUpperCase()}
            </div>
          </div>
          {wallet && streak && streak.current > 0 && (
            <span style={{
              fontSize: 6, color: "#0a0a14", background: GOLD, borderRadius: 4, padding: "4px 6px", flexShrink: 0,
            }}>
              DAY {streak.current}
            </span>
          )}
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{
          display: "grid", gap: layout.short ? 6 : 10,
          gridTemplateColumns: layout.wide ? "minmax(0, 1.4fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
          alignItems: "start",
        }}>
          {/* ── The calendar leads ── */}
          <Block short={layout.short}>
            <CityCalendar cellHeight={layout.short ? 16 : 22} showLegend={!layout.short} maxRows={layout.short ? 2 : 3} />
          </Block>

          {/* ── Then who leads the city, and who is here ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: layout.short ? 6 : 8 }}>
            <Block short={layout.short}>
              <Title icon={`${UI}/ico_achievements.png`}>CITY LEADERS</Title>
              <Leader img="/assets/minigames/kite/kites/kite_stb.png" label="KITE" row={leaders.kite} me={wallet} />
              <Leader img={`${UI}/attention_green.png`} label="FINDER" row={leaders.hunt} me={wallet} />
              <Leader img={`${UI}/ico_achievements.png`} label="STREAK" row={leaders.streak} me={wallet} unit="d" />
            </Block>

            <Block short={layout.short}>
              <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
                <RankTab active={rankTab === "online"} color={GREEN} onClick={() => setRankTab("online")}>
                  ONLINE{online.length > 0 ? ` (${online.length})` : ""}
                </RankTab>
                <RankTab active={rankTab === "alltime"} color={GOLD} onClick={() => setRankTab("alltime")}>
                  ALL TIME
                </RankTab>
              </div>
              {rankTab === "alltime" && allTime === null ? (
                <Empty>Loading...</Empty>
              ) : rows.length === 0 ? (
                <Empty>{rankTab === "online" ? "Nobody else is online right now." : "No scores yet."}</Empty>
              ) : (
                <>
                  {rows.slice(0, RANK_ROWS).map((r, i) => (
                    <RankRow key={r.wallet} rank={i + 1} name={names.display(r.wallet, r.fallback)} score={r.score} self={r.wallet === wallet} />
                  ))}
                  {myIndex >= RANK_ROWS && (
                    <RankRow rank={myIndex + 1} name={names.display(rows[myIndex].wallet, rows[myIndex].fallback)} score={rows[myIndex].score} self />
                  )}
                </>
              )}
            </Block>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes tc-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
        .tc-in { animation: tc-in .22s ease; }
      `}</style>
    </div>
  );
}

/**
 * Wide: two columns (calendar left, leaders and ranking right). Short:
 * tighter spacing and a smaller calendar, for landscape phones.
 */
function useLayout(): { wide: boolean; short: boolean } {
  const read = () => {
    if (typeof window === "undefined") return { wide: false, short: false };
    return { wide: window.innerWidth >= 680, short: window.innerHeight < 560 };
  };
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const onResize = () => setLayout(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return layout;
}

function Block({ children, short }: { children: React.ReactNode; short?: boolean }) {
  return (
    <div style={{
      background: "#0d0d22", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8,
      padding: short ? 6 : 9,
    }}>
      {children}
    </div>
  );
}

function Title({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <Img src={icon} h={12} />
      <span style={{ fontSize: 6, color: "#94a3b8" }}>{children}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 6, color: "#475569", padding: "6px 0" }}>{children}</div>;
}

/** One leader per row: icon, what they lead, who, how much. */
function Leader({ img, label, row, me, unit = "" }: { img: string; label: string; row?: BoardRow; me: string | null; unit?: string }) {
  const mine = !!row && row.wallet === me;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
      <Img src={img} h={12} />
      <span style={{ fontSize: 6, color: "#64748b", width: 40, flexShrink: 0 }}>{label}</span>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 6, color: mine ? GOLD : "#e2e8f0",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {row ? (row.name ?? short(row.wallet)) : "-"}
      </span>
      <span style={{ fontSize: 6, color: GOLD }}>{row ? `${row.value}${unit}` : ""}</span>
    </div>
  );
}

function RankTab({ active, color, onClick, children }: { active: boolean; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none", border: "none", padding: "2px 0", cursor: "pointer", fontFamily: PIXEL, fontSize: 6,
        color: active ? color : "#475569", borderBottom: `2px solid ${active ? color : "transparent"}`,
      }}
    >
      {children}
    </button>
  );
}

function RankRow({ rank, name, score, self }: { rank: number; name: string; score: number; self: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, marginTop: 4, padding: "3px 5px", borderRadius: 4,
      background: self ? "rgba(20,241,149,0.08)" : "transparent",
    }}>
      <span style={{ fontSize: 6, color: rank <= 3 ? GOLD : "#475569", width: 16 }}>{rank}</span>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 6, color: self ? GREEN : "#cbd5e1",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {name}
      </span>
      <span style={{ fontSize: 6, color: GOLD }}>{score}</span>
    </div>
  );
}
