import { describe, expect, it } from "vitest";
import { ART, CarveScore, KNIFE_SPEED, PASS_ACCURACY, PATTERN, SHAPE_DONE, TOLERANCE, sampleOutline, stepKnife, walkSegment } from "./pattern";

/** Traces every shape, shifted by (dx, dy) art px. */
function traceAll(score: CarveScore, dx = 0, dy = 0, shapes = PATTERN): void {
  for (const shape of shapes) {
    const pts = [...shape, shape[0]];
    for (let i = 1; i < pts.length; i++) {
      walkSegment(pts[i - 1][0] + dx, pts[i - 1][1] + dy, pts[i][0] + dx, pts[i][1] + dy, (x, y) => score.add(x, y));
    }
  }
}

describe("CarveScore", () => {
  it("scores a perfect trace at 100", () => {
    const s = new CarveScore();
    traceAll(s);
    expect(s.accuracy).toBe(100);
    expect(s.slips).toHaveLength(0);
    expect(s.missed()).toHaveLength(0);
  });

  it("passes a careful trace a couple of pixels off", () => {
    const s = new CarveScore(TOLERANCE.mouse);
    traceAll(s, 2, 0);
    expect(s.accuracy).toBeGreaterThanOrEqual(PASS_ACCURACY);
  });

  it("fails a mouse trace that drifts 4 pixels off", () => {
    const s = new CarveScore(TOLERANCE.mouse);
    traceAll(s, 3, 3);
    expect(s.accuracy).toBeLessThan(PASS_ACCURACY);
  });

  it("gives a finger a little more room than a mouse", () => {
    const mouse = new CarveScore(TOLERANCE.mouse);
    const finger = new CarveScore(TOLERANCE.touch);
    traceAll(mouse, 2.5, 1);
    traceAll(finger, 2.5, 1);
    expect(finger.accuracy).toBeGreaterThan(mouse.accuracy);
  });

  it("fails a trace that skips the mouth, and reports it as missed", () => {
    const s = new CarveScore();
    traceAll(s, 0, 0, PATTERN.slice(0, 3));
    expect(s.accuracy).toBeLessThan(PASS_ACCURACY);
    expect(s.missed().length).toBeGreaterThan(100);
  });

  it("fails scribbling over the whole pumpkin, and reports the slips", () => {
    const s = new CarveScore();
    for (let y = 30; y < 110; y += 3) walkSegment(20, y, ART - 20, y, (x, yy) => s.add(x, yy));
    expect(s.accuracy).toBeLessThan(PASS_ACCURACY);
    expect(s.slips.length).toBeGreaterThan(1000);
  });

  it("scores nothing for no cuts", () => {
    expect(new CarveScore().accuracy).toBe(0);
  });

  it("counts coverage per shape, for popping pieces", () => {
    const s = new CarveScore();
    traceAll(s, 0, 0, PATTERN.slice(0, 1));
    expect(s.shapeCoverage(0)).toBeGreaterThanOrEqual(SHAPE_DONE);
    expect(s.shapeCoverage(3)).toBe(0);
  });
});

/** A hand tracing the outline at `hand` art px/s, the heavy knife chasing it. */
function chase(hand: number): number {
  const score = new CarveScore(TOLERANCE.mouse);
  const dt = 1 / 60;
  for (const shape of PATTERN) {
    const path = sampleOutline([shape], 0.25);
    path.push(path[0]);
    let tip = { x: path[0].x, y: path[0].y };
    for (let t = 0; ; t += dt) {
      const i = Math.min(path.length - 1, Math.floor((t * hand) / 0.25));
      const p = path[i];
      const next = stepKnife(tip, p, dt);
      let skip = true;
      walkSegment(tip.x, tip.y, next.x, next.y, (x, y) => { if (skip) { skip = false; return; } score.add(x, y); });
      tip = next;
      if (i === path.length - 1 && Math.hypot(tip.x - p.x, tip.y - p.y) < 0.01) break;
    }
  }
  return score.accuracy;
}

describe("the heavy knife", () => {
  it("stays on the line at the knife's own pace", () => {
    expect(chase(KNIFE_SPEED)).toBeGreaterThanOrEqual(95);
  });

  it("cuts across the corners when the hand rushes ahead", () => {
    expect(chase(KNIFE_SPEED * 2)).toBeLessThan(PASS_ACCURACY);
  });

  it("never moves the tip further than its speed allows", () => {
    const next = stepKnife({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.1);
    expect(next.x).toBeCloseTo(KNIFE_SPEED * 0.1);
  });
});
