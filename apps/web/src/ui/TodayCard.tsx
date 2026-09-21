"use client";

/**
 * Today in Solana City: the card that opens on the first visit of each day.
 *
 * Everything on it updates by itself, so it never waits on someone to post:
 * your check-in streak, today's quests, who leads the city, and a calendar
 * of Superteam bounty and hackathon deadlines plus the city's own events
 * (game/daily/calendar.ts).
 *
 * The component is always mounted: it also does the daily check-in, signed
 * with the session key, whether or not the card is shown.
 */
import { useCallback, useEffect, useState } from "react";
import nacl from "tweetnacl";
import { useWallet } from "@solana/wallet-adapter-react";
import type { OnChainMultiplayer } from "@/game/multiplayer/OnChainMultiplayer";
import { checkinMessage } from "@/lib/checkinMessage";
import { fetchBoard, type BoardRow } from "@/game/leaderboards/boards";
import { DAILY_QUESTS, getQuestProgress, onQuestsChanged } from "@/game/quests/QuestManager";
import { OPEN_TODAY_EVENT } from "@/game/daily/todayEvents";
import { Citizen, Img, guideSeen } from "./CityGuide";
import CityCalendar from "./CityCalendar";

export { OPEN_TODAY_EVENT };

const PIXEL = '"Press Start 2P", monospace';
const GREEN = "#14F195";
const GOLD = "#FFD700";
const UI = "/assets/ui";
const SEEN_KEY = "solcity:today-seen";

interface StreakView {
  current: number;
  best: number;
  checkedInToday: boolean;
  recent: string[];
}

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

/** The last seven UTC days, oldest first. */
function lastSevenDays(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 6; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - i));
    out.push(utcDay(x));
  }
  return out;
}

export default function TodayCard({ gameRef }: { gameRef: Phaser.Game | null }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [open, setOpen] = useState(false);
  const [streak, setStreak] = useState<StreakView | null>(null);
  const [leaders, setLeaders] = useState<{ kite?: BoardRow; hunt?: BoardRow; streak?: BoardRow }>({});
  const [, setQuestTick] = useState(0);
  const layout = useLayout();

  // ── Daily check-in: signed with the session key, retried while the key is
  // still being authorized on-chain in the first seconds after connecting.
  useEffect(() => {
    if (!gameRef || !wallet) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

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
          if (body.ok && body.streak) {
            if (!cancelled) setStreak(body.streak);
            return;
          }
          if (!body.retry) return; // store off or a hard failure: stop quietly
        } catch { /* network blip: retry */ }
      }
      if (++attempts < 24) timer = setTimeout(attempt, 5_000);
    };

    // Show the stored streak straight away; the check-in updates it.
    fetch(`/api/checkin?wallet=${wallet}`)
      .then((r) => r.json())
      .then((b) => { if (!cancelled && b.streak) setStreak(b.streak); })
      .catch(() => undefined);
    void attempt();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [gameRef, wallet]);

  // ── Opening: once per UTC day on entering the city, never on the very
  // first visit (Sol's guide owns that one), and from the quest panel.
  const [firstVisit] = useState(() => !guideSeen());
  useEffect(() => {
    const onEnter = () => {
      if (firstVisit || seenToday()) return;
      window.setTimeout(() => setOpen(true), 1_200);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("solcity:entered-city", onEnter);
    window.addEventListener(OPEN_TODAY_EVENT, onOpen);
    return () => {
      window.removeEventListener("solcity:entered-city", onEnter);
      window.removeEventListener(OPEN_TODAY_EVENT, onOpen);
    };
  }, [firstVisit]);

  // ── Content, loaded when the card opens.
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
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => onQuestsChanged(() => setQuestTick((n) => n + 1)), []);

  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const progress = wallet ? getQuestProgress(wallet) : {};
  const days = lastSevenDays();
  const checked = new Set(streak?.recent ?? []);
  const today = new Date();

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
        {/* Header: one line */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: layout.short ? 6 : 10 }}>
          <Citizen sheet="Sol.png" size={layout.short ? 22 : 28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 8, color: GREEN }}>TODAY IN SOLANA CITY</div>
            <div style={{ fontSize: 6, color: "#64748b", marginTop: 4 }}>
              {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).toUpperCase()}
            </div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{
          display: "grid", gap: layout.short ? 6 : 10,
          gridTemplateColumns: layout.wide ? "minmax(0, 1.4fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
          alignItems: "start",
        }}>
          {/* ── Priority: streak and calendar ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: layout.short ? 6 : 8 }}>
            <Block short={layout.short}>
              {wallet && streak ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 18, color: GOLD, lineHeight: 1 }}>{streak.current}</span>
                    <span style={{ fontSize: 6, color: "#94a3b8", lineHeight: 1.5 }}>DAY<br />STREAK</span>
                  </div>
                  <div style={{ flex: 1, display: "flex", gap: 3 }}>
                    {days.map((d) => {
                      const on = checked.has(d);
                      const isToday = d === utcDay();
                      return (
                        <div key={d} style={{
                          flex: 1, height: 16, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center",
                          background: on ? GOLD : "#1e1e3a",
                          boxShadow: isToday ? `0 0 0 1px ${on ? "#fff" : "#64748b"}` : "none",
                          fontSize: 5, color: on ? "#0a0a14" : "#64748b",
                        }}>
                          {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}
                        </div>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 6, color: "#64748b", flexShrink: 0 }}>BEST {streak.best}</span>
                </div>
              ) : (
                <div style={{ fontSize: 7, color: "#94a3b8" }}>
                  {wallet ? "Checking you in..." : "Connect a wallet to start a daily streak."}
                </div>
              )}
            </Block>

            <Block short={layout.short}>
              <CityCalendar cellHeight={layout.short ? 16 : 22} showLegend={!layout.short} maxRows={layout.short ? 2 : 3} />
            </Block>
          </div>

          {/* ── Below: today's quests and the city leaders ── */}
          <div style={{
            display: "grid", gap: layout.short ? 6 : 8,
            gridTemplateColumns: !layout.wide && layout.twoUp ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
          }}>
            <Block short={layout.short}>
              <Title icon={`${UI}/ico_tasks.png`}>TODAY&apos;S QUESTS</Title>
              {DAILY_QUESTS.map((q) => {
                const p = progress[q.id];
                const current = Math.min(p?.current ?? 0, q.target);
                const done = !!p?.completed;
                return (
                  <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                    <span style={{
                      fontSize: 6, color: done ? GREEN : "#cbd5e1", flex: "0 1 96px", minWidth: 0,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{q.title}</span>
                    <div style={{ flex: 1, height: 5, background: "#1e1e3a", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(current / q.target) * 100}%`, height: "100%", background: done ? GREEN : "#9945FF" }} />
                    </div>
                    <span style={{ fontSize: 6, color: done ? GREEN : "#64748b", width: 28, textAlign: "right" }}>
                      {done ? "DONE" : `${current}/${q.target}`}
                    </span>
                  </div>
                );
              })}
            </Block>

            <Block short={layout.short}>
              <Title icon={`${UI}/ico_achievements.png`}>CITY LEADERS</Title>
              <Leader img="/assets/minigames/kite/kites/kite_stb.png" label="KITE" row={leaders.kite} me={wallet} />
              <Leader img={`${UI}/attention_green.png`} label="FINDER" row={leaders.hunt} me={wallet} />
              <Leader img={`${UI}/ico_achievements.png`} label="STREAK" row={leaders.streak} me={wallet} unit="d" />
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
 * Wide: two columns (streak and calendar left, the rest right). Short: tighter
 * spacing and a smaller calendar, for landscape phones. twoUp: a narrow but
 * not tiny screen, where quests and leaders sit side by side.
 */
function useLayout(): { wide: boolean; short: boolean; twoUp: boolean } {
  const read = () => {
    if (typeof window === "undefined") return { wide: false, short: false, twoUp: false };
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { wide: w >= 680, short: h < 560, twoUp: w >= 440 };
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
