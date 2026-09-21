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
        background: "rgba(4,6,14,0.62)", padding: 12,
      }}
    >
      <div
        className="tc-in"
        style={{
          width: "min(400px, 100%)", maxHeight: "92vh", overflowY: "auto",
          background: "linear-gradient(180deg, #14142e 0%, #0b0b1c 100%)",
          border: "1px solid rgba(153,69,255,0.45)", borderRadius: 12, padding: 14,
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)", fontFamily: PIXEL, color: "#e2e8f0",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Citizen sheet="Sol.png" size={40} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: GREEN }}>TODAY IN SOLANA CITY</div>
            <div style={{ fontSize: 7, color: "#64748b", marginTop: 5 }}>
              {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).toUpperCase()}
            </div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {/* Streak */}
        <Block>
          {wallet && streak ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ textAlign: "center", minWidth: 64 }}>
                <div style={{ fontSize: 22, color: GOLD, lineHeight: 1 }}>{streak.current}</div>
                <div style={{ fontSize: 6, color: "#94a3b8", marginTop: 6 }}>DAY STREAK</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 4 }}>
                  {days.map((d) => {
                    const on = checked.has(d);
                    const isToday = d === utcDay();
                    return (
                      <div key={d} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{
                          height: 18, borderRadius: 4,
                          background: on ? GOLD : "#1e1e3a",
                          boxShadow: isToday ? `0 0 0 2px ${on ? "#fff" : "#475569"}` : "none",
                        }} />
                        <div style={{ fontSize: 6, color: isToday ? "#fff" : "#475569", marginTop: 4 }}>
                          {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 6, color: "#64748b", marginTop: 6 }}>
                  BEST {streak.best} · COME BACK TOMORROW TO KEEP IT
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 7, color: "#94a3b8", lineHeight: 1.8 }}>
              {wallet ? "Checking you in..." : "Connect a wallet to start a daily streak."}
            </div>
          )}
        </Block>

        {/* Today's quests */}
        <Title icon={`${UI}/ico_tasks.png`}>TODAY&apos;S QUESTS</Title>
        <Block>
          {DAILY_QUESTS.map((q) => {
            const p = progress[q.id];
            const current = Math.min(p?.current ?? 0, q.target);
            const done = !!p?.completed;
            return (
              <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                <span style={{ fontSize: 7, color: done ? GREEN : "#cbd5e1", width: 110, flexShrink: 0 }}>{q.title}</span>
                <div style={{ flex: 1, height: 6, background: "#1e1e3a", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${(current / q.target) * 100}%`, height: "100%", background: done ? GREEN : "#9945FF" }} />
                </div>
                <span style={{ fontSize: 6, color: done ? GREEN : "#64748b", width: 44, textAlign: "right" }}>
                  {done ? "DONE" : `${current}/${q.target}`}
                </span>
              </div>
            );
          })}
        </Block>

        {/* City leaders */}
        <Title icon={`${UI}/ico_achievements.png`}>CITY LEADERS</Title>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
          <Leader img="/assets/minigames/kite/kites/kite_stb.png" label="KITE" row={leaders.kite} me={wallet} />
          <Leader img={`${UI}/attention_green.png`} label="FINDER" row={leaders.hunt} me={wallet} />
          <Leader img={`${UI}/ico_achievements.png`} label="STREAK" row={leaders.streak} me={wallet} unit="d" />
        </div>

        {/* Calendar: deadlines and city events, filled by itself */}
        <Title icon={`${UI}/attention_purple.png`}>CALENDAR</Title>
        <Block>
          <CityCalendar />
        </Block>

        <button
          onClick={close}
          style={{
            display: "block", width: "100%", marginTop: 4, background: GREEN, color: "#0a0a14",
            border: "none", borderRadius: 8, padding: "11px 0", cursor: "pointer", fontFamily: PIXEL, fontSize: 8,
          }}
        >
          LET&apos;S GO
        </button>
      </div>
      <style>{`
        @keyframes tc-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
        .tc-in { animation: tc-in .22s ease; }
      `}</style>
    </div>
  );
}

function Block({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#0d0d22", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8,
      padding: 10, marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function Title({ icon, sheet, children }: { icon?: string; sheet?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
      {icon && <Img src={icon} h={14} />}
      {sheet && <Citizen sheet={sheet} size={20} />}
      <span style={{ fontSize: 7, color: "#94a3b8" }}>{children}</span>
    </div>
  );
}

function Leader({ img, label, row, me, unit = "" }: { img: string; label: string; row?: BoardRow; me: string | null; unit?: string }) {
  const mine = !!row && row.wallet === me;
  return (
    <div style={{
      background: "#0d0d22", borderRadius: 8, padding: "8px 6px", textAlign: "center",
      border: `1px solid ${mine ? "rgba(255,215,0,0.5)" : "rgba(255,255,255,0.05)"}`,
    }}>
      <Img src={img} h={22} style={{ margin: "0 auto" }} />
      <div style={{ fontSize: 6, color: "#64748b", marginTop: 6 }}>{label}</div>
      <div style={{ fontSize: 7, color: mine ? GOLD : "#e2e8f0", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row ? (row.name ?? short(row.wallet)) : "-"}
      </div>
      <div style={{ fontSize: 8, color: GOLD, marginTop: 4 }}>{row ? `${row.value}${unit}` : ""}</div>
    </div>
  );
}
