/**
 * Content-height hug reducer: decides how the frame container reacts to each
 * `frame-height` measurement posted by the live iframe.
 *
 * WHY THIS EXISTS (the runaway-collapse bug). The container hugs the reported
 * `#root` height, and the iframe fills the container (height:100%). For a frame
 * whose root height is VIEWPORT-RELATIVE (fractional `vh`, or a percentage-height
 * chain rooted at 100vh — e.g. `h-[90vh]`), each measurement round feeds the
 * PREVIOUS applied height back in at a fraction: 900 → 810 → 729 → … a geometric
 * decay that collapses the frame to a 1px sliver. (`h-screen`/100vh is the
 * neutral fixed point and stays stable; only a fraction decays.) A separate
 * failure mode: a frame whose height oscillates by a pixel (899↔900) or animates
 * every frame posts forever, churning the parent at 60fps.
 *
 * We can't decouple the iframe height from the hug — portal-based overlays
 * (modals, popovers) center in the iframe's OWN viewport, so a taller iframe
 * than the visible crop would push them out of view. So instead we damp the
 * feedback SIGNAL deterministically.
 *
 * THE HARD PART: telling feedback-decay apart from a LEGITIMATE shrink. A user
 * collapsing three accordion panels, filtering a list down, or an image/font
 * settling ALSO produce a run of decreasing heights — identical in value-space
 * to the decay. Counting "N shrinks in a row" alone can't distinguish them, and
 * an early version froze those legit shrinks at their TALLEST height (dead white
 * space that never recovered). The signal that IS specific to the feedback loop:
 *   - TIMING. The vh feedback cascade is a synchronous ResizeObserver storm —
 *     each measurement lands milliseconds after the last. A user interaction is
 *     spaced by hundreds of ms. So a shrink that arrives AFTER `BURST_WINDOW_MS`
 *     is trusted as user-driven and applied verbatim (streak reset).
 *   - SUSTAINED run. A one-shot reflow (image loads big, then CSS constrains it
 *     to its final size) shrinks once or twice and SETTLES. Only a run of
 *     `RUNAWAY_RUN` rapid, back-to-back shrinks — the geometric-decay signature —
 *     trips the freeze.
 * And the freeze is NOT permanent: any GROWTH (a modal opens, an accordion
 * expands) or a later SPACED settle releases it, so a frame whose content
 * legitimately changes height after a decay is never stuck.
 *
 * Pure + framework-free (takes an explicit `now`) so the decay/oscillation/settle
 * behaviour is unit-tested without a live iframe or a real clock (the sibling
 * visualNoOp / framePageRestore precedent).
 */

/** Reported heights below this (px) are collapse artifacts, not real designs. */
export const HEIGHT_FLOOR = 16;
/** Ignore a change smaller than this (px): oscillation + micro-animation churn. */
export const HEIGHT_MIN_DELTA = 4;
/**
 * Consecutive RAPID (burst) shrinks that mean "feedback collapse". A one-shot
 * reflow settles in 1–2 steps; only a sustained run this long is the decay.
 */
export const HEIGHT_RUNAWAY_RUN = 4;
/**
 * A shrink arriving within this many ms of the last applied change is part of a
 * synchronous layout cascade (the feedback loop). A shrink spaced further out is
 * a user-driven content change and is always trusted. ResizeObserver cascades
 * fire within a frame or two (<100ms); deliberate interactions are >200ms apart.
 */
export const BURST_WINDOW_MS = 200;

export interface HeightState {
  /** Last height applied to the container; null = full-viewport fallback. */
  applied: number | null;
  /** Trusted pre-burst height — the target we pin to when a runaway is caught. */
  peak: number;
  /** Count of consecutive RAPID (within-burst) shrinks. Reset by growth/spacing. */
  shrinkStreak: number;
  /** Timestamp (ms) of the last applied change or pin — drives burst detection. */
  lastAt: number;
  /**
   * Held against further burst-shrinks after a runaway. NOT permanent: growth or
   * a spaced settle thaws it, so legit later height changes always get through.
   */
  frozen: boolean;
}

export function initialHeightState(): HeightState {
  return { applied: null, peak: 0, shrinkStreak: 0, lastAt: 0, frozen: false };
}

export interface HeightDecision {
  state: HeightState;
  /** True when the container height should change to `height`. */
  changed: boolean;
  /** The height to apply when `changed` (a positive px value). */
  height: number;
}

/**
 * Fold one reported content height into the state. `now` is a millisecond
 * timestamp (Date.now() in the app; controlled values in tests). Returns the
 * next state and whether/what the container should apply. Never returns a change
 * below the floor or within the hysteresis band; freezes only on a rapid,
 * sustained decay and thaws on growth or a spaced settle.
 */
export function reduceHeight(state: HeightState, reported: number, now: number): HeightDecision {
  const noChange = (s: HeightState): HeightDecision => ({ state: s, changed: false, height: state.applied ?? 0 });

  // Ignore non-finite, non-positive, and collapse-artifact heights outright.
  if (!Number.isFinite(reported) || reported < HEIGHT_FLOOR) return noChange(state);

  const cur = state.applied;
  // First real measurement — adopt it as the baseline and the peak.
  if (cur == null) {
    return {
      state: { applied: reported, peak: reported, shrinkStreak: 0, lastAt: now, frozen: false },
      changed: true,
      height: reported,
    };
  }

  const delta = reported - cur;
  // Hysteresis: sub-threshold delta (incl. exact repeat) → ignore. Kills a 1px
  // oscillation and a frame that re-measures a hair different every animation
  // frame. Leaves the frozen/streak state untouched (a stable tick is not a
  // shrink and must not reset the decay bookkeeping).
  if (Math.abs(delta) < HEIGHT_MIN_DELTA) return noChange(state);

  // GROWTH — always apply. A taller measurement can never be a decay artifact:
  // it's a modal opening, an accordion expanding, a page growing. This also
  // THAWS a prior freeze so a post-decay height change is never suppressed.
  if (delta >= HEIGHT_MIN_DELTA) {
    return {
      state: { applied: reported, peak: Math.max(state.peak, reported), shrinkStreak: 0, lastAt: now, frozen: false },
      changed: true,
      height: reported,
    };
  }

  // SHRINK (delta <= -HEIGHT_MIN_DELTA).
  const elapsed = now - state.lastAt;
  if (elapsed > BURST_WINDOW_MS) {
    // Spaced from the last change → user-driven content shrink (collapse, filter,
    // settled reflow). Trust it verbatim, reset the streak, re-baseline the peak,
    // and thaw — the old peak is stale now.
    return {
      state: { applied: reported, peak: reported, shrinkStreak: 0, lastAt: now, frozen: false },
      changed: true,
      height: reported,
    };
  }

  // Rapid (burst) shrink — a candidate feedback-decay step.
  if (state.frozen) return noChange(state); // cascade continues; keep suppressing.

  const shrinkStreak = state.shrinkStreak + 1;
  if (shrinkStreak >= HEIGHT_RUNAWAY_RUN) {
    // Sustained rapid decay. Pin to the PEAK (the trusted pre-burst height) and
    // freeze against further burst-shrinks. Growth / a spaced settle will thaw.
    const peak = state.peak;
    return {
      state: { applied: peak, peak, shrinkStreak: 0, lastAt: now, frozen: true },
      changed: peak !== cur,
      height: peak,
    };
  }

  // Not yet a runaway — apply the shrink and keep counting. A one-shot reflow
  // that settles here (streak stays < RUNAWAY_RUN) lands at its real height.
  return {
    state: { applied: reported, peak: state.peak, shrinkStreak, lastAt: now, frozen: false },
    changed: true,
    height: reported,
  };
}
