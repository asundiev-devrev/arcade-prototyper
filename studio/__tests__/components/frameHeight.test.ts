// @vitest-environment node
//
// The content-height hug had a runaway-collapse bug: a fractional-vh frame fed
// its own shrinking height back in each measurement round and decayed to a 1px
// sliver. These pin the damping reducer that kills it WITHOUT freezing a
// legitimate shrink (accordion collapse, list filter, image/font settle) — the
// distinguishing signal is TIMING (a synchronous ResizeObserver burst vs a
// spaced user interaction), not the value stream, which is identical.
import { describe, it, expect } from "vitest";
import {
  reduceHeight,
  initialHeightState,
  HEIGHT_FLOOR,
  HEIGHT_MIN_DELTA,
  HEIGHT_RUNAWAY_RUN,
  BURST_WINDOW_MS,
  type HeightState,
} from "../../src/components/viewport/frameHeight";

/**
 * Feed a sequence of reported heights. Each item is either a bare number (a
 * RAPID tick, +10ms — the feedback-cascade cadence) or `[height, gapMs]` to
 * space it from the previous tick. Returns applied heights + final state.
 */
function run(
  seq: Array<number | [number, number]>,
  start: HeightState = initialHeightState(),
) {
  let state = start;
  let clock = 1_000_000;
  const applied: number[] = [];
  for (const item of seq) {
    const [h, gap] = Array.isArray(item) ? item : [item, 10];
    clock += gap;
    const d = reduceHeight(state, h, clock);
    state = d.state;
    if (d.changed) applied.push(d.height);
  }
  return { applied, state };
}

describe("reduceHeight", () => {
  it("applies the first real measurement", () => {
    const { applied } = run([640]);
    expect(applied).toEqual([640]);
  });

  it("holds steady on an h-screen frame (neutral fixed point) — one apply, then quiet", () => {
    // 100vh resolves to the iframe height, so #root re-reports the SAME value
    // every round. It must apply once and then never churn.
    const { applied } = run([812, 812, 812, 812]);
    expect(applied).toEqual([812]);
  });

  it("FREEZES a rapid fractional-vh decay and pins to the peak (no sliver)", () => {
    // The bug: 900 → 810 → 729 → 656 → 590 … a geometric collapse arriving as a
    // synchronous ResizeObserver burst. The reducer must detect the rapid shrink
    // run and freeze at the PEAK, never chasing it down to a 1px sliver.
    const { applied, state } = run([900, 810, 729, 656, 590, 531]);
    expect(state.frozen).toBe(true);
    // It settled back at the peak, not a collapsed height.
    expect(applied[applied.length - 1]).toBe(900);
    expect(Math.min(...applied)).toBeGreaterThanOrEqual(656);
  });

  it("freezes after exactly HEIGHT_RUNAWAY_RUN rapid shrinks (not one fewer)", () => {
    // Off-by-one guard: with RUNAWAY_RUN=4 it must take 4 real downward steps to
    // freeze. Feed peak + (RUNAWAY_RUN-1) shrinks → NOT yet frozen; the next
    // shrink trips it.
    const peak = 1000;
    const seq: number[] = [peak];
    let h = peak;
    for (let i = 0; i < HEIGHT_RUNAWAY_RUN - 1; i++) seq.push((h -= 50));
    const mid = run(seq);
    expect(mid.state.frozen).toBe(false); // 3 shrinks — still trusting them
    // One more RAPID shrink (within the burst window) → freeze on the RUNAWAY_RUN-th.
    const d = reduceHeight(mid.state, h - 50, mid.state.lastAt + 10);
    expect(d.state.frozen).toBe(true);
    expect(d.height).toBe(peak);
  });

  it("stays frozen — ignores further RAPID shrinks after a runaway is detected", () => {
    const { state } = run([900, 810, 729, 656, 590]);
    expect(state.frozen).toBe(true);
    // Another burst-tick shrink is suppressed.
    const after = reduceHeight(state, 100, state.lastAt + 10);
    expect(after.changed).toBe(false);
  });

  // --- The regression the re-review caught: legit shrinks must NOT freeze. ---

  it("does NOT freeze a SPACED user-driven shrink run (accordion collapse / list filter)", () => {
    // Same value stream as a decay, but each step is a deliberate interaction
    // seconds apart. Every shrink is trusted and applied; the frame settles at
    // its REAL final height (no dead white space, no freeze).
    const gap = BURST_WINDOW_MS + 300;
    const { applied, state } = run([
      800,
      [700, gap],
      [600, gap],
      [500, gap],
      [400, gap],
    ]);
    expect(state.frozen).toBe(false);
    expect(applied).toEqual([800, 700, 600, 500, 400]);
  });

  it("does NOT freeze a one-shot reflow that settles down in a couple steps (image/font)", () => {
    // A hero image loads at natural size then CSS constrains it: a rapid 2-step
    // shrink that SETTLES. Under the runaway threshold → applied, not frozen.
    const { applied, state } = run([2000, 1200, 900]);
    expect(state.frozen).toBe(false);
    expect(applied).toEqual([2000, 1200, 900]);
  });

  it("THAWS on growth — a modal/accordion expand after a freeze is applied, not suppressed", () => {
    // Regression: once frozen the old reducer ignored ALL later heights until a
    // committed edit reset it, so opening a tall modal was clipped forever. Now
    // any growth thaws the freeze and applies.
    const { state } = run([900, 810, 729, 656, 590]);
    expect(state.frozen).toBe(true);
    const grow = reduceHeight(state, 1300, state.lastAt + 5000);
    expect(grow.changed).toBe(true);
    expect(grow.height).toBe(1300);
    expect(grow.state.frozen).toBe(false);
  });

  it("THAWS on a spaced shrink after a freeze — a later collapse still applies", () => {
    // After a decay freeze at the peak, a genuine (spaced) content shrink must
    // re-baseline, not be swallowed as more decay.
    const { state } = run([900, 810, 729, 656, 590]);
    expect(state.frozen).toBe(true);
    const collapse = reduceHeight(state, 400, state.lastAt + BURST_WINDOW_MS + 500);
    expect(collapse.changed).toBe(true);
    expect(collapse.height).toBe(400);
    expect(collapse.state.frozen).toBe(false);
  });

  it("ignores sub-threshold jitter (a 1px oscillation never churns) without disturbing decay state", () => {
    const { applied } = run([700, 701, 700, 701, 700]);
    expect(applied).toEqual([700]);
    expect(HEIGHT_MIN_DELTA).toBeGreaterThan(1);
  });

  it("drops collapse-artifact heights below the floor", () => {
    const { applied } = run([HEIGHT_FLOOR - 1, 2, 0]);
    expect(applied).toEqual([]);
  });

  it("ignores non-finite / non-positive reports", () => {
    const s = initialHeightState();
    expect(reduceHeight(s, NaN, 1).changed).toBe(false);
    expect(reduceHeight(s, -50, 1).changed).toBe(false);
    expect(reduceHeight(s, Infinity, 1).changed).toBe(false);
  });

  it("a genuine GROWTH mid-shrink resets the streak (does not creep toward a freeze)", () => {
    // Two rapid shrinks then a real expansion — the expansion applies and clears
    // the shrink streak so a later shrink run starts fresh.
    const { applied, state } = run([600, 560, 520, 900]);
    expect(applied[applied.length - 1]).toBe(900);
    expect(state.shrinkStreak).toBe(0);
    expect(state.frozen).toBe(false);
  });
});
