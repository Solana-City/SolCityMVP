/**
 * Send latency, averaged on the client and reported once a minute.
 *
 * Movement sends a transaction every 200ms, and each one used to become its
 * own analytics event: about 50 Redis commands a second for one walking
 * player, which spent the whole Upstash free tier in a few hours of testing.
 * The dev panel only ever shows averages and slow counts, so one averaged
 * event per kind per minute tells it the same thing.
 */
import { track } from "./track";

const FLUSH_MS = 60_000;

interface Bucket {
  sum: number;
  n: number;
  label: string;
}

const buckets = new Map<string, Bucket>();
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function flush(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  for (const [id, b] of buckets) {
    if (b.n === 0) continue;
    track("latency", id, { value: Math.round(b.sum / b.n), label: `${b.n}x ${b.label}` });
  }
  buckets.clear();
}

export function trackLatency(id: string, ms: number, label = ""): void {
  const b = buckets.get(id) ?? { sum: 0, n: 0, label };
  b.sum += Math.max(0, ms);
  b.n += 1;
  b.label = label || b.label;
  buckets.set(id, b);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
  if (!listening && typeof window !== "undefined") {
    listening = true;
    // Leaving the tab: report what was measured rather than lose it.
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
}
