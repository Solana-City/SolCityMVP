/**
 * SoundManager — all game SFX synthesized live via the Web Audio API.
 *
 * No audio files are imported or fetched: every sound is generated from
 * oscillators + noise at play time, which keeps the bundle byte-for-byte
 * the same, matches the pixel-art / 8-bit aesthetic, and means there's
 * nothing to load or cache. Richer textures (ambient city loop, music)
 * would need real imported assets and are intentionally out of scope here.
 *
 * Design:
 *   - One shared AudioContext, created lazily and only after a user
 *     gesture (browsers suspend audio until then — see unlock()).
 *   - A master gain the mute/volume controls ride on.
 *   - A tiny synthesis toolkit (tone / sweep / noiseBurst) that each SFX
 *     is composed from, so adding a sound is a few lines, not an asset.
 *   - Framework-agnostic singleton: React UI and the Phaser scene both
 *     import the same instance and call play(...).
 */

export type Sfx =
  | "click"      // UI button press / minigame buttons
  | "outfit"     // outfit selection — dry, slightly varied
  | "dialog"     // NPC dialog opens
  | "emote"      // player emote / chat emoji
  | "chime"      // discrete on-chain tx confirmed (swap / transfer / bounty)
  | "reward"     // score / outfit unlock
  | "achievement"// achievement unlocked (bigger than reward)
  | "victory"    // minigame won — brief triumphant sting
  | "error";     // minigame lost / action failed

const MUTE_KEY = "solcity:muted";
const VOLUME_KEY = "solcity:volume";
/** Master volume default — deliberately low; the Settings slider raises it. */
const DEFAULT_VOLUME = 0.35;

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private volume = DEFAULT_VOLUME;
  /** Guards footstep spam — the walk loop can call every frame. */
  private lastFootstepAt = 0;
  private footstepToggle = false;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = localStorage.getItem(MUTE_KEY) === "1";
        const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? "");
        if (!Number.isNaN(v)) this.volume = Math.min(1, Math.max(0, v));
      } catch { /* ignore */ }
    }
  }

  /** Effective master gain = volume unless muted. */
  private effectiveGain(): number {
    return this.muted ? 0 : this.volume;
  }

  /**
   * Lazily create (or resume) the AudioContext. Must be triggered from a
   * user gesture the first time — call unlock() from a global pointer/key
   * handler; play() also attempts a resume so a click that makes a sound
   * works on the same gesture.
   */
  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.effectiveGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Call once from the first user gesture to prime the audio context. */
  unlock(): void {
    this.ensureContext();
  }

  isMuted(): boolean { return this.muted; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = this.effectiveGain();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** 0..1 master volume. */
  getVolume(): number { return this.volume; }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOLUME_KEY, String(this.volume)); } catch { /* ignore */ }
    // Raising the slider off zero implies "I want sound" — clear mute too.
    if (this.volume > 0 && this.muted) this.setMuted(false);
    if (this.master) this.master.gain.value = this.effectiveGain();
  }

  // ── Synthesis primitives ──────────────────────────────────────────────

  /** A single enveloped oscillator note. */
  private tone(opts: {
    freq: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;   // seconds from now
    attack?: number;
    release?: number;
  }): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const { freq, dur, type = "square", gain = 0.3, delay = 0, attack = 0.005, release = 0.06 } = opts;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, t0 + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** A pitch glide between two frequencies. */
  private sweep(opts: {
    from: number;
    to: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
  }): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const { from, to, dur, type = "sine", gain = 0.3, delay = 0 } = opts;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** A short band-limited noise burst — footsteps, taps. */
  private noiseBurst(opts: { dur: number; gain?: number; freq?: number; q?: number }): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const { dur, gain = 0.15, freq = 900, q = 0.7 } = opts;
    const t0 = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ── Public SFX ────────────────────────────────────────────────────────

  play(sfx: Sfx): void {
    if (this.muted) return;
    switch (sfx) {
      case "click":
        // Soft "pip" — a triangle (not square) with a gentle downward
        // glide and a filtered noise transient for a tactile tap, rather
        // than the flat square beep that read as a calculator.
        this.sweep({ from: 560, to: 470, dur: 0.05, type: "triangle", gain: 0.12 });
        this.noiseBurst({ dur: 0.012, gain: 0.03, freq: 2600, q: 1.2 });
        break;
      case "outfit": {
        // Dry, percussive "tok" with a touch of random pitch so repeated
        // selections don't sound identical. No ring — short decays only.
        const j = (Math.random() - 0.5) * 2; // -1..1
        this.noiseBurst({ dur: 0.02, gain: 0.06, freq: 480 + j * 60, q: 1.6 });
        this.tone({ freq: 320 + j * 30, dur: 0.03, type: "triangle", gain: 0.11, attack: 0.001, release: 0.024 });
        break;
      }
      case "dialog":
        this.tone({ freq: 440, dur: 0.06, type: "triangle", gain: 0.2 });
        this.tone({ freq: 660, dur: 0.07, type: "triangle", gain: 0.2, delay: 0.05 });
        break;
      case "emote":
        this.sweep({ from: 320, to: 640, dur: 0.16, type: "sine", gain: 0.22 });
        break;
      case "chime":
        // Two-note pleasant confirm — Solana-y ascending fifth.
        this.tone({ freq: 660, dur: 0.09, type: "triangle", gain: 0.22 });
        this.tone({ freq: 988, dur: 0.14, type: "triangle", gain: 0.22, delay: 0.08 });
        break;
      case "reward":
        // Coin-like C-E-G arpeggio.
        this.tone({ freq: 523, dur: 0.07, type: "square", gain: 0.16 });
        this.tone({ freq: 659, dur: 0.07, type: "square", gain: 0.16, delay: 0.06 });
        this.tone({ freq: 784, dur: 0.12, type: "square", gain: 0.16, delay: 0.12 });
        break;
      case "achievement":
        // Fuller fanfare — C-E-G-C with a sparkle tail.
        this.tone({ freq: 523, dur: 0.10, type: "triangle", gain: 0.22 });
        this.tone({ freq: 659, dur: 0.10, type: "triangle", gain: 0.22, delay: 0.09 });
        this.tone({ freq: 784, dur: 0.10, type: "triangle", gain: 0.22, delay: 0.18 });
        this.tone({ freq: 1047, dur: 0.22, type: "triangle", gain: 0.24, delay: 0.27 });
        this.tone({ freq: 1568, dur: 0.10, type: "sine", gain: 0.10, delay: 0.30 });
        break;
      case "victory": {
        // Brief triumphant "ta-da!" — quick ascending G-C-E landing on a
        // held high note with a sparkle, snappier than the achievement
        // fanfare so a minigame win reads as a punchy sting, not a jingle.
        this.tone({ freq: 784, dur: 0.07, type: "square", gain: 0.2 });                      // G5
        this.tone({ freq: 1047, dur: 0.07, type: "square", gain: 0.2, delay: 0.07 });          // C6
        this.tone({ freq: 1319, dur: 0.26, type: "triangle", gain: 0.24, delay: 0.14 });       // E6 (held)
        this.tone({ freq: 784, dur: 0.20, type: "sine", gain: 0.08, delay: 0.14 });            // body under the E
        this.tone({ freq: 1976, dur: 0.12, type: "sine", gain: 0.08, delay: 0.18 });           // sparkle
        break;
      }
      case "error":
        this.sweep({ from: 300, to: 120, dur: 0.28, type: "sawtooth", gain: 0.18 });
        break;
    }
  }

  /**
   * Footstep — subtle, throttled noise tick. Called from the local
   * player's walk loop only (never remote players or the pedestrian crowd,
   * which would be a wall of noise). Alternates pitch a touch so a walk
   * cycle sounds like left/right rather than one repeated sample.
   */
  playFootstep(): void {
    if (this.muted) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - this.lastFootstepAt < 260) return;
    this.lastFootstepAt = now;
    this.footstepToggle = !this.footstepToggle;
    this.noiseBurst({ dur: 0.05, gain: 0.05, freq: this.footstepToggle ? 820 : 680, q: 0.9 });
  }
}

export const soundManager = new SoundManager();
