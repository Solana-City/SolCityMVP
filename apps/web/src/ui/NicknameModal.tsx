"use client";

/**
 * Choose or change your nickname.
 *
 * Opened by itself the first time a wallet enters the city without a name
 * (skippable), and from the Profile afterwards. The player sees their own
 * character with the tag above it as they type, a live availability check,
 * and a plain warning that offensive names get locked.
 */
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { checkName, claimName } from "@/game/names/nameService";
import { LockIcon } from "@/ui/PixelIcons";
import { chamferBox } from "@/ui/chamfer";

const PIX = '"Press Start 2P", monospace';
const RULE = /^[A-Za-z][A-Za-z0-9_]{2,15}$/;

export default function NicknameModal({ wallet, current, forced, onDone }: {
  wallet: string;
  current: string | null;
  forced: boolean;
  onDone: (name: string | null) => void;
}) {
  const { signMessage } = useWallet();
  const [name, setName] = useState(current ?? "");
  const [state, setState] = useState<{ kind: "idle" | "checking" | "ok" | "bad"; message?: string }>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Live check, debounced.
  useEffect(() => {
    const n = name.trim();
    setError(null);
    if (!n || n === current) { setState({ kind: "idle" }); return; }
    if (!RULE.test(n)) {
      setState({ kind: "bad", message: n.length < 3 || n.length > 16 ? "Use 3 to 16 characters." : "Start with a letter. Letters, numbers and _ only." });
      return;
    }
    setState({ kind: "checking" });
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await checkName(n, wallet);
        if (my !== seq.current) return;
        setState(r.available ? { kind: "ok", message: "Available!" } : { kind: "bad", message: r.message ?? "Not available." });
      } catch {
        if (my === seq.current) setState({ kind: "bad", message: "Could not check. Try again." });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [name, wallet, current]);

  const save = async () => {
    const n = name.trim();
    if (state.kind !== "ok" || saving) return;
    if (!signMessage) { setError("This wallet can't sign messages."); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await claimName(wallet, n, signMessage);
      if (r.ok) onDone(n);
      else setError(r.message ?? "Could not save.");
    } catch {
      setError("Signature cancelled.");
    } finally {
      setSaving(false);
    }
  };

  const preview = name.trim() || "YOUR NAME";
  const color = state.kind === "ok" ? "#B7E928" : state.kind === "bad" ? "#ff6b6b" : "#8b8ba7";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 80, background: "rgba(4,6,16,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 12, fontFamily: PIX,
    }}>
      <div style={{
        width: "min(400px, 100%)", maxHeight: "100%", overflowY: "auto", padding: 16,
        background: "#0c0f1e",
        borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
        borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
        imageRendering: "pixelated",
        boxShadow: "0 16px 50px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <span style={{ color: "#B7E928", fontSize: 9 }}>{current ? "CHANGE NICKNAME" : "CHOOSE YOUR NICKNAME"}</span>
          {!forced && (
            <button onClick={() => onDone(null)} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", color: "#14F0C6", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
          )}
        </div>

        {/* Live preview: your character with the tag other players will see. */}
        <div style={chamferBox(10, {
          height: 104, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 50% 70%, rgba(183,233,40,0.12), rgba(12,15,30,0) 70%), #10132a",
          border: "1px solid rgba(183,233,40,0.18)", marginBottom: 12,
        })}>
          <span style={{ fontSize: 8, color: "#e2e2f5", textShadow: "0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000, 0 -1px 0 #000", marginBottom: 2 }}>
            {preview}
          </span>
          <div aria-hidden style={{
            width: 64, height: 64, backgroundImage: 'url("/assets/sprites/main_char.png")',
            backgroundSize: "256px 256px", backgroundPosition: "0 0", imageRendering: "pixelated",
          }} />
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value.replace(/\s/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") save(); e.stopPropagation(); }}
          maxLength={16}
          autoFocus
          placeholder="Nickname"
          spellCheck={false}
          style={chamferBox(8, {
            width: "100%", boxSizing: "border-box", padding: "10px 12px", outline: "none",
            background: "#12122a", color: "#fff", fontFamily: PIX, fontSize: 11,
            border: `1px solid ${state.kind === "idle" ? "rgba(153,69,255,0.3)" : color}`,
          })}
        />
        <div style={{ minHeight: 18, marginTop: 6, fontSize: 7, color, lineHeight: 1.6 }}>
          {state.kind === "checking" ? "Checking..." : state.message ?? "3 to 16 letters, numbers or _. Every name is unique."}
        </div>

        <div style={chamferBox(8, {
          display: "flex", gap: 10, alignItems: "flex-start", margin: "8px 0 14px", padding: "9px 10px", 
          background: "rgba(255,90,90,0.08)", border: "1px solid rgba(255,90,90,0.35)",
        })}>
          <span style={{ flexShrink: 0, marginTop: 1 }}><LockIcon size={14} color="#fca5a5" /></span>
          <span style={{ fontSize: 7, color: "#fca5a5", lineHeight: 1.7 }}>
            Offensive names are not allowed. The Solana City team can remove them and apply a name lock.
          </span>
        </div>

        {error && <div style={{ fontSize: 7, color: "#ff6b6b", marginBottom: 8, textAlign: "center" }}>{error}</div>}

        <button
          onClick={save}
          disabled={state.kind !== "ok" || saving}
          style={chamferBox(8, {
            width: "100%", padding: "11px 0", border: "none", fontFamily: PIX, fontSize: 8,
            cursor: state.kind === "ok" && !saving ? "pointer" : "not-allowed",
            background: state.kind === "ok" ? "#B7E928" : "#2a2a45", color: state.kind === "ok" ? "#04140c" : "#666688",
          })}
        >
          {saving ? "SIGN IN YOUR WALLET..." : "SAVE NICKNAME"}
        </button>
        {!current && !forced && (
          <button
            onClick={() => onDone(null)}
            style={chamferBox(8, {
              width: "100%", marginTop: 8, padding: "9px 0", fontFamily: PIX, fontSize: 7,
              background: "transparent", border: "1px solid rgba(139,139,167,0.35)", color: "#8b8ba7", cursor: "pointer",
            })}
          >
            SKIP FOR NOW
          </button>
        )}
        <div style={{ fontSize: 6, color: "#555577", textAlign: "center", marginTop: 8, lineHeight: 1.6 }}>
          No fee. Change it anytime in Profile.
        </div>
      </div>
    </div>
  );
}
