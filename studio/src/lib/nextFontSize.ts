/**
 * Maps a line count (measured at the starting/maximum font size) to the
 * rendered font size. Discrete steps, one per added line, keep the shrink
 * deterministic and idempotent per keystroke — the same text always produces
 * the same size, so there's no oscillation.
 *
 * The caller should measure line count against a hidden mirror that's pinned
 * to `start`, not against the live textarea whose height depends on the
 * output of this function (that's a feedback loop).
 *
 * Curve rationale:
 *   1 line  → start (no change)
 *   2 lines → one step smaller
 *   N lines → each extra line shaves one more step, down to floor
 */
export interface FontSizeForLinesArgs {
  /** Number of visually-wrapped lines at the starting font size. */
  lines: number;
  /** Max (starting) font-size in px. */
  start: number;
  /** Floor font-size in px. Below this the textarea scrolls instead of shrinking further. */
  floor: number;
  /** Step size in px between line-count tiers. */
  step: number;
}

export function fontSizeForLines({ lines, start, floor, step }: FontSizeForLinesArgs): number {
  const shrinkSteps = Math.max(0, Math.floor(lines) - 1);
  const target = start - shrinkSteps * step;
  return Math.max(floor, target);
}
