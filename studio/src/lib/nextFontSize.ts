export interface NextFontSizeArgs {
  /** Current rendered font-size in px. */
  current: number;
  /** Max (starting) font-size in px. The input never grows past this. */
  start: number;
  /** Floor font-size in px. Below this we scroll instead of shrinking. */
  floor: number;
  /** Step size in px for each shrink/grow iteration. */
  step: number;
  /** Last-measured textarea scrollHeight in px. */
  measuredHeight: number;
  /** Target max height the textarea should fit within. */
  maxHeight: number;
}

/**
 * Pure font-size stepper used by HeroPromptInput. Returns the next font-size
 * to render based on whether the textarea is overflowing or has slack.
 *
 * The React caller runs this inside useLayoutEffect after every text change:
 * set the size, re-measure on the next render, call again. One-step-at-a-time
 * keeps each iteration legible and animatable.
 */
export function nextFontSize({
  current,
  start,
  floor,
  step,
  measuredHeight,
  maxHeight,
}: NextFontSizeArgs): number {
  if (measuredHeight > maxHeight && current > floor) {
    return Math.max(floor, current - step);
  }
  if (current < start) {
    // Predict scrollHeight at the next larger size assuming near-linear
    // scaling. Only grow if the prediction still fits, so we don't
    // oscillate between two adjacent sizes.
    const predicted = measuredHeight * ((current + step) / current);
    if (predicted <= maxHeight) {
      return Math.min(start, current + step);
    }
  }
  return current;
}
