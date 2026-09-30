/**
 * MusicManager — background music (BGM) for the city.
 *
 * The counterpart to SoundManager: that one synthesizes every SFX live, this
 * one streams real recorded tracks from /assets/audio/bgm. Music is the one
 * thing synthesis cannot fake, so these are files — but they never touch the
 * bundle and they are deliberately kept out of the service worker precache
 * (see publicExcludes in next.config.js), so nobody downloads megabytes of
 * music just to load the game. A track is fetched the moment it first plays
 * and then lives in the browser's HTTP cache.
 *
 * Design:
 *   - ONE HTMLAudioElement, reused for every track. Streaming (not
 *     decodeAudioData) keeps memory flat regardless of track length, and
 *     reusing a single element means iOS only has to unlock audio once:
 *     later play() calls on an already-started element are allowed outside
 *     a user gesture, which is exactly what advancing a playlist needs.
 *   - A shuffle bag picks the next track, never the one just played, so the
 *     city does not loop the same eight minutes. Adding tracks to TRACKS is
 *     the only step needed to widen the rotation.
 *   - Tracks cross into each other with a fade out / fade in rather than a
 *     hard cut. A second element for a true crossfade would double the
 *     streaming cost and re-open the iOS unlock problem for no real gain on
 *     ambient music.
 *   - Its own volume + mute, separate from the SFX pair, persisted per
 *     device. At zero volume (or muted) playback is PAUSED, not just silent:
 *     someone who turns music off should not keep paying for the download.
 */

export type BgmTrack = {
  id: string;
  /** Shown in Settings so the rotation is visible, not a mystery. */
  title: string;
  src: string;
};

const BGM = "/assets/audio/bgm";

export const TRACKS: BgmTrack[] = [
  { id: "morning", title: "Pixel City Morning", src: `${BGM}/pixel_city_morning.mp3` },
  { id: "day",     title: "Pixel City Day",     src: `${BGM}/pixel_city_day.mp3` },
];

const MUTE_KEY = "solcity:musicMuted";
const VOLUME_KEY = "solcity:musicVolume";
/** Music sits under the SFX so a chime still cuts through. */
const DEFAULT_VOLUME = 0.4;

/** Seconds of fade at each end of a track. */
const FADE_OUT = 3;
const FADE_IN = 2;
/** Fade step interval — coarse enough to be free, fine enough to be smooth. */
const FADE_TICK_MS = 50;
/**
 * Events that count as user activation everywhere. AudioBridge unlocks the
 * SFX context on pointerdown, but Safari only grants activation on the
 * completed gesture, so a play() there can still be refused — hence the
 * retry on these.
 */
const GESTURES = ["pointerup", "touchend", "keyup"] as const;

class MusicManager {
  private el: HTMLAudioElement | null = null;
  private muted = false;
  private volume = DEFAULT_VOLUME;
  /** 0..1 fade envelope, multiplied into volume. */
  private fade = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  /** True once a user gesture has allowed us to start; nothing plays before. */
  private started = false;
  /** Guards the end-of-track handoff from firing on every timeupdate. */
  private advancing = false;
  private index = -1;
  /** Remaining picks in the current shuffle bag. */
  private bag: number[] = [];
  /** Consecutive load failures — stops a dead playlist from spinning. */
  private failures = 0;
  private listeners = new Set<() => void>();
  /** Set when the tab hid us mid-track, so returning resumes rather than restarts. */
  private pausedByHide = false;
  private retryArmed = false;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = localStorage.getItem(MUTE_KEY) === "1";
        const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? "");
        if (!Number.isNaN(v)) this.volume = Math.min(1, Math.max(0, v));
      } catch { /* ignore */ }
      // Music in a tab nobody is looking at is pure battery and bandwidth.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          if (this.el && !this.el.paused) { this.el.pause(); this.pausedByHide = true; }
        } else if (this.pausedByHide) {
          this.pausedByHide = false;
          if (this.wantsSound()) this.el?.play().catch(() => {});
        }
      });
    }
  }

  // ── Settings ──────────────────────────────────────────────────────────

  isMuted(): boolean { return this.muted; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
    this.applyGain();
    this.syncPlayback();
    this.emit();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** 0..1 music volume. */
  getVolume(): number { return this.volume; }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOLUME_KEY, String(this.volume)); } catch { /* ignore */ }
    // Raising the slider off zero implies "I want music" — clear mute too.
    if (this.volume > 0 && this.muted) { this.muted = false; try { localStorage.setItem(MUTE_KEY, "0"); } catch { /* ignore */ } }
    this.applyGain();
    this.syncPlayback();
    this.emit();
  }

  /** The track playing right now, or null when music is off. */
  nowPlaying(): BgmTrack | null {
    if (!this.started || this.index < 0 || !this.wantsSound()) return null;
    return TRACKS[this.index] ?? null;
  }

  /** Settings subscribes so the now-playing line follows the rotation. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // ── Playback ──────────────────────────────────────────────────────────

  /**
   * Call once from the first user gesture (the same one that unlocks the
   * SFX context). Autoplay policy only grants play() from inside a gesture,
   * and every later track rides on that same element's permission.
   */
  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    if (!this.wantsSound()) return;  // music off: don't fetch a thing
    this.playNext();
  }

  private wantsSound(): boolean {
    return !this.muted && this.volume > 0;
  }

  private ensureElement(): HTMLAudioElement {
    if (this.el) return this.el;
    const el = new Audio();
    el.preload = "none";
    el.loop = false;
    el.addEventListener("timeupdate", () => {
      // End-of-track handoff: fade out over the tail, then load the next.
      const d = el.duration;
      if (!Number.isFinite(d) || this.advancing) return;
      if (d - el.currentTime <= FADE_OUT) {
        this.advancing = true;
        this.fadeTo(0, (d - el.currentTime) * 1000, () => this.playNext());
      }
    });
    // Safety net: a track that ends without the tail fade (a seek, a short
    // file, a browser that skips timeupdate near the end) still advances.
    el.addEventListener("ended", () => { if (!this.advancing) { this.advancing = true; this.playNext(); } });
    el.addEventListener("error", () => {
      this.failures++;
      if (this.failures >= TRACKS.length) return;  // whole playlist is dead
      this.advancing = true;
      this.playNext();
    });
    el.addEventListener("playing", () => { this.failures = 0; this.emit(); });
    this.el = el;
    return el;
  }

  /** Next index from the shuffle bag, never repeating the last track. */
  private pickNext(): number {
    if (TRACKS.length <= 1) return 0;
    if (this.bag.length === 0) {
      this.bag = TRACKS.map((_, i) => i);
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
      // A fresh bag starting on the track we just played would repeat it.
      if (this.bag[0] === this.index && this.bag.length > 1) {
        [this.bag[0], this.bag[1]] = [this.bag[1], this.bag[0]];
      }
    }
    return this.bag.shift()!;
  }

  private playNext(): void {
    const el = this.ensureElement();
    this.index = this.pickNext();
    this.advancing = false;
    this.cancelFade();
    this.fade = 0;
    this.applyGain();
    el.src = TRACKS[this.index].src;
    el.play().then(() => {
      this.fadeTo(1, FADE_IN * 1000);
    }).catch(() => {
      // Refused (autoplay) or unplayable. Don't loop here: reset the envelope
      // and wait for the next real activation to try again.
      this.fade = 1;
      this.applyGain();
      this.armRetry();
    });
    this.emit();
  }

  /** Mute / zero volume pauses; turning music back on resumes or starts. */
  private syncPlayback(): void {
    if (!this.started) return;
    const el = this.el;
    if (!this.wantsSound()) {
      el?.pause();
      return;
    }
    if (!el || !el.src) { this.playNext(); return; }
    if (el.paused && !document.hidden) el.play().catch(() => {});
  }

  /** One-shot: retry playback on the next completed user gesture. */
  private armRetry(): void {
    if (this.retryArmed || typeof window === "undefined") return;
    this.retryArmed = true;
    const retry = () => {
      this.retryArmed = false;
      GESTURES.forEach((ev) => window.removeEventListener(ev, retry, true));
      if (this.wantsSound() && (!this.el || this.el.paused)) this.playNext();
    };
    GESTURES.forEach((ev) => window.addEventListener(ev, retry, true));
  }

  private applyGain(): void {
    if (!this.el) return;
    const g = this.muted ? 0 : this.volume * this.fade;
    this.el.volume = Math.min(1, Math.max(0, g));
  }

  private cancelFade(): void {
    if (this.fadeTimer) { clearInterval(this.fadeTimer); this.fadeTimer = null; }
  }

  private fadeTo(target: number, ms: number, done?: () => void): void {
    this.cancelFade();
    const from = this.fade;
    const span = Math.max(FADE_TICK_MS, ms);
    const t0 = Date.now();
    this.fadeTimer = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / span);
      this.fade = from + (target - from) * k;
      this.applyGain();
      if (k >= 1) { this.cancelFade(); done?.(); }
    }, FADE_TICK_MS);
  }

  private emit(): void {
    this.listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }
}

export const musicManager = new MusicManager();
