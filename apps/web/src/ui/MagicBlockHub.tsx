"use client";

/**
 * Magic Man's panel: the MagicBlock hub.
 *
 * Two audiences meet at this NPC, and the panel says so rather than mixing
 * them. A player wants to move USDC without the city reading it. A developer
 * wants to know what the city is actually built on, because the same
 * technology is what makes a 3v3 mech battle feel instant.
 *
 * So: one action area (private transfers, the real on-chain flow) and three
 * short explainers that each end at MagicBlock's own documentation. The
 * explainers stay one screen long on purpose — the docs are the deep end,
 * this is the sign that points at it.
 */
import { useState } from "react";
import { LockIcon } from "@/ui/PixelIcons";
import { track } from "@/game/telemetry/track";
import { chamferBox } from "@/ui/chamfer";

const PIXEL = '"Press Start 2P", monospace';
const MAGENTA = "#c026d3";
const CYAN = "#14F0C6";
const GREEN = "#B7E928";

type Area = "private" | "er" | "per" | "vrf";

interface Topic {
  id: Exclude<Area, "private">;
  label: string;
  tagline: string;
  color: string;
  /** Three lines, no more: this is a signpost, not a chapter. */
  points: string[];
  /** How Solana City itself uses it, which is the part a visitor can verify. */
  inTheCity: string;
  docs: string;
}

const TOPICS: Topic[] = [
  {
    id: "er",
    label: "EPHEMERAL ROLLUPS",
    tagline: "Solana speed, Solana security",
    color: CYAN,
    points: [
      "You hand one account to a temporary validator.",
      "Writes land in milliseconds, with no fee popups.",
      "State commits back to Solana when you are done.",
    ],
    inTheCity:
      "Every step you take here is a transaction on a rollup. That is why the city moves at all.",
    docs: "https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-rollup",
  },
  {
    id: "per",
    label: "PRIVATE ROLLUPS",
    tagline: "Same speed, nobody reading",
    color: MAGENTA,
    points: [
      "The rollup runs inside a sealed environment.",
      "Balances and moves stay hidden while they execute.",
      "Only the result is published to Solana.",
    ],
    inTheCity:
      "The private transfers on the left run this way: the city sees that something happened, not what.",
    docs: "https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/onchain-privacy",
  },
  {
    id: "vrf",
    label: "VERIFIABLE RANDOMNESS",
    tagline: "Dice nobody can load",
    color: GREEN,
    points: [
      "Your program asks for a random number.",
      "An oracle answers with a proof it was not chosen.",
      "Anyone can check the roll afterwards.",
    ],
    inTheCity:
      "What the wardrobe booster packs will draw from, so a rare hat is luck and not a favour.",
    docs: "https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/introduction/solana-vrf",
  },
];

const QUICKSTART = "https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/quickstart";

export interface MagicBlockHubProps {
  /** The real private-transfer flow, rendered when the player picks it. */
  children: React.ReactNode;
}

export default function MagicBlockHub({ children }: MagicBlockHubProps) {
  const [area, setArea] = useState<Area | null>(null);

  if (area === "private") {
    return (
      <>
        <BackRow onBack={() => setArea(null)} />
        {children}
      </>
    );
  }

  const topic = TOPICS.find((t) => t.id === area);
  if (topic) {
    return (
      <>
        <BackRow onBack={() => setArea(null)} />
        <TopicView topic={topic} />
      </>
    );
  }

  return (
    <>
      <header style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <LockIcon size={14} color={MAGENTA} />
          <h3 style={{ fontFamily: PIXEL, fontSize: 10, color: MAGENTA, margin: 0 }}>MAGIC MAN</h3>
        </div>
        <p style={{ fontSize: 9, color: "#8a8aa7", margin: "8px 0 0", lineHeight: 1.7 }}>
          MagicBlock runs this city. Move money privately, or see how it works.
        </p>
      </header>

      <div style={eyebrow}>DO IT HERE</div>
      <button onClick={() => { track("protocol-open", "magicblock-private"); setArea("private"); }} style={actionCard}>
        <span style={{ fontFamily: PIXEL, fontSize: 9, color: MAGENTA }}>PRIVATE TRANSFER</span>
        <span style={{ fontSize: 9, color: "#9a9ad0", lineHeight: 1.6 }}>
          Deposit, send USDC nobody can read, withdraw.
        </span>
        <span style={{ fontSize: 8, color: GREEN }}>On-chain, in the city</span>
      </button>

      <div style={{ ...eyebrow, marginTop: 16 }}>BUILD WITH IT</div>
      <div style={{ display: "grid", gap: 8 }}>
        {TOPICS.map((t) => (
          <button
            key={t.id}
            onClick={() => { track("tutorial", `magicblock-${t.id}`, { value: 1, label: "opened" }); setArea(t.id); }}
            style={topicCard(t.color)}
          >
            <span style={{ fontFamily: PIXEL, fontSize: 8, color: t.color }}>{t.label}</span>
            <span style={{ fontSize: 9, color: "#8a8aa7" }}>{t.tagline}</span>
          </button>
        ))}
      </div>

      <a
        href={QUICKSTART}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track("tutorial", "magicblock-quickstart", { success: true, label: "docs" })}
        style={{ ...docsLink, marginTop: 14, display: "block", textAlign: "center" }}
      >
        DEVELOPER QUICKSTART
      </a>
    </>
  );
}

function TopicView({ topic }: { topic: Topic }) {
  return (
    <>
      <h3 style={{ fontFamily: PIXEL, fontSize: 9, color: topic.color, margin: "0 0 4px" }}>
        {topic.label}
      </h3>
      <p style={{ fontSize: 9, color: "#8a8aa7", margin: "0 0 14px" }}>{topic.tagline}</p>

      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {topic.points.map((point, i) => (
          <li key={point} style={pointRow}>
            <span style={{ ...pointNumber, color: topic.color, borderColor: `${topic.color}55` }}>{i + 1}</span>
            <span style={{ fontSize: 9, color: "#c9c9e4", lineHeight: 1.7 }}>{point}</span>
          </li>
        ))}
      </ol>

      <div style={{ ...cityNote, borderColor: `${topic.color}33` }}>
        <span style={{ fontSize: 8, color: topic.color }}>IN THIS CITY</span>
        <p style={{ fontSize: 9, color: "#9a9ad0", margin: "6px 0 0", lineHeight: 1.7 }}>{topic.inTheCity}</p>
      </div>

      <a
        href={topic.docs}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track("tutorial", `magicblock-${topic.id}`, { success: true, label: "docs" })}
        style={{ ...docsLink, borderColor: `${topic.color}66`, color: topic.color, marginTop: 14, display: "block", textAlign: "center" }}
      >
        READ THE DOCS
      </a>
    </>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} style={backButton}>
      {"< BACK"}
    </button>
  );
}

const eyebrow: React.CSSProperties = {
  fontFamily: PIXEL,
  fontSize: 7,
  color: "#555577",
  letterSpacing: 1,
  marginBottom: 8,
};

const actionCard: React.CSSProperties = chamferBox(10, {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  textAlign: "left",
  padding: "12px 14px",
  background: "rgba(192,38,211,0.10)",
  border: `1px solid ${MAGENTA}55`,
  cursor: "pointer",
});

function topicCard(color: string): React.CSSProperties {
  return chamferBox(10, {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    textAlign: "left",
    padding: "11px 14px",
    background: "rgba(255,255,255,0.03)",
    border: `1px solid ${color}33`,
    cursor: "pointer",
  });
}

const pointRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
};

const pointNumber: React.CSSProperties = {
  fontFamily: PIXEL,
  fontSize: 8,
  width: 20,
  height: 20,
  flexShrink: 0,
  borderRadius: "50%",
  border: "1px solid",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cityNote: React.CSSProperties = chamferBox(8, {
  marginTop: 14,
  padding: "10px 12px",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid",
});

const docsLink: React.CSSProperties = chamferBox(8, {
  fontFamily: PIXEL,
  fontSize: 8,
  padding: "10px 0",
  border: "1px solid rgba(153,69,255,0.45)",
  color: "#c084fc",
  textDecoration: "none",
});

const backButton: React.CSSProperties = {
  fontFamily: PIXEL,
  fontSize: 7,
  color: "#8a8aa7",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "0 0 12px",
};
