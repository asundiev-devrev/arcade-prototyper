// studio/src/export/figma/geometryMatch.ts
export interface Rect { x: number; y: number; width: number; height: number; }

export interface MatchOpts {
  /** Max accepted edge-distance sum (|Δleft|+|Δright|+|Δtop|+|Δbottom|). */
  threshold: number;
  /** Best must beat the next-best by at least this much, else ambiguous → reject. */
  ambiguityGap: number;
  /** Candidate area must be within ±areaTol of target area (0.25 = ±25%). */
  areaTol: number;
}

export const DEFAULT_MATCH_OPTS: MatchOpts = { threshold: 8, ambiguityGap: 4, areaTol: 0.25 };

function edgeScore(a: Rect, b: Rect): number {
  return (
    Math.abs(a.x - b.x) +
    Math.abs((a.x + a.width) - (b.x + b.width)) +
    Math.abs(a.y - b.y) +
    Math.abs((a.y + a.height) - (b.y + b.height))
  );
}

/** Pick the candidate whose box best matches `target`, or null when no candidate
 *  is within threshold, the best is area-mismatched, or the match is ambiguous. */
export function matchByGeometry<T extends Rect>(
  target: Rect,
  candidates: T[],
  opts: MatchOpts = DEFAULT_MATCH_OPTS,
): T | null {
  const targetArea = target.width * target.height;
  const scored = candidates
    .filter((c) => c.width > 0 && c.height > 0)
    .filter((c) => {
      const area = c.width * c.height;
      return area >= targetArea * (1 - opts.areaTol) && area <= targetArea * (1 + opts.areaTol);
    })
    .map((c) => ({ c, score: edgeScore(target, c) }))
    .sort((a, b) => a.score - b.score);

  if (scored.length === 0) return null;
  const best = scored[0];
  if (best.score > opts.threshold) return null;
  if (scored.length > 1 && scored[1].score - best.score < opts.ambiguityGap) return null;
  return best.c;
}
