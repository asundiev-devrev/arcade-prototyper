// studio/src/lift/metrics.ts
//
// Lift-loop metric: count the "decision points" a manifest forces on the
// downstream agent. Lower is better. The plan at
// studio/docs/plans/2026-05-11-lift-manifest-rules-over-tables.md uses this
// as a PR gate — each change to the mapping tables or renderer must not
// raise the count on the lift-loop fixtures without an explicit reason.
//
// Why this shape and not "count TODOs in the agent's output":
//   - Cheap, deterministic, runs in unit-test time (no agent call).
//   - Measurable directly from the Manifest object.
//   - Correlates with the thing we actually want — manifests that answer
//     questions themselves instead of punting to the reviewer.
//
// The four inputs reflect what the lift agent actually sees:
//   unmapped   — imports with no entry at all; today's dead-end
//   judgment   — explicit "ask the user" mappings
//   naMappings — mappings with no production equivalent (Studio-only chrome)
//   needsProp  — propDeltas marked needsReviewer (future use; zero today)

import type { Manifest } from "./types";

export interface LiftMetrics {
  /** Total decision points — sum of the four categories below. */
  decisionPoints: number;
  /**
   * Non-icon imports with no mapping entry. These become `<unmapped/>` in
   * the XML. Icons are tracked separately in `iconsAbsorbed` and do NOT
   * count against decisionPoints — the icon convention resolves them.
   */
  unmapped: number;
  /** Mappings with translationClass === "judgment". */
  judgment: number;
  /** Mappings whose production.source === "n/a" (no production equivalent). */
  naMappings: number;
  /** PropDeltas explicitly flagged for reviewer attention. Reserved. */
  needsReviewerProps: number;
  /**
   * Informational: icon imports absorbed by the icon_convention. Not part
   * of decisionPoints — the convention is responsible for resolving them.
   * Exposed so fixture baselines can see how many icons a frame had without
   * tying that count to the pass/fail gate.
   */
  iconsAbsorbed: number;
  /**
   * Informational: mappings flagged `close-but-not-identity`. These are
   * NOT reviewer decisions — the manifest's per-delta notes tell the
   * agent exactly how to wrap / adapt. Counted for visibility so a
   * regression (e.g. a formerly mechanical mapping quietly growing
   * wrapper-required notes) is obvious in BASELINE.md. Added 2026-05-13.
   */
  closeButNotIdentity: number;
}

export function computeMetrics(m: Manifest): LiftMetrics {
  const unmapped = m.unmapped.length;
  const iconsAbsorbed = m.iconImports.length;
  let judgment = 0;
  let naMappings = 0;
  let needsReviewerProps = 0;
  let closeButNotIdentity = 0;
  // Track distinct entries that contribute AT LEAST ONE reviewer decision
  // (judgment class, no production equivalent, or both). A single entry
  // that is both judgment AND n/a is still one decision — the agent reads
  // it once and leaves one TODO. Validated against two live lift runs
  // 2026-05-12; see docs/plans/2026-05-12-lift-manifest-pr6-revision.md.
  const decisionEntries = new Set<object>();

  // Dedupe by MappingEntry identity for the bucket breakdown too.
  // findMapping() returns the same reference for the same (source, name),
  // so imports[*].names dedup at parse time already keeps each entry at
  // most once in mappings[] — but Set here is defensive against future
  // mapping aliases.
  const uniqueMappings = new Set(m.mappings);
  for (const entry of uniqueMappings) {
    const isJudgment = entry.translationClass === "judgment";
    const isNa = entry.production.source === "n/a";
    const isCloseButNotIdentity =
      entry.translationClass === "close-but-not-identity";
    if (isJudgment) judgment++;
    if (isNa) naMappings++;
    if (isCloseButNotIdentity) closeButNotIdentity++;
    if (isJudgment || isNa) decisionEntries.add(entry);
  }
  for (const entry of m.mappings) {
    for (const delta of entry.propDeltas) {
      if ((delta as { needsReviewer?: boolean }).needsReviewer) {
        needsReviewerProps++;
      }
    }
  }

  return {
    // decisionPoints collapses judgment and naMappings into a single
    // "reviewer decision" bucket per entry — a judgment+n/a mapping is
    // ONE decision, not two. The per-bucket judgment/naMappings counts
    // stay in the breakdown for diagnostic visibility.
    decisionPoints: unmapped + decisionEntries.size + needsReviewerProps,
    unmapped,
    judgment,
    naMappings,
    needsReviewerProps,
    iconsAbsorbed,
    closeButNotIdentity,
  };
}
