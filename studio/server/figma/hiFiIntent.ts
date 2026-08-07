/**
 * "Did the designer ask for an EXACT implementation?" — the fidelity-intent
 * detector, as a ZERO-IMPORT LEAF.
 *
 * WHY IT LIVES HERE RATHER THAN IN fidelityDirective.ts, WHERE IT WAS BORN. Two
 * things on the routing path need this answer, and both are BRAIN — code that has
 * to run identically inside Studio, Claude Code, Cursor or Computer:
 *
 *   1. `detectFreshImportIntent` (server/figma/generationIntent.ts) uses it to
 *      keep a STATED faithful-copy ask on the deterministic importer even when
 *      provenance can see the pasted node in an existing frame.
 *   2. `shouldSuppressWholeFrame` (server/figma/turnDirectives.ts) takes the value
 *      as `ctx.explicitHiFi`, so a host must be able to compute it.
 *
 * `fidelityDirective.ts` is not itself dirty — measured, its import closure is one
 * file — but it is 250 lines of Studio-specific DIRECTIVE TEXT naming the
 * `figmanage` CLI, a binary no foreign host has. Splitting the 20 lines of
 * DETECTION out of the prose means the audited brain closure grows by a leaf
 * instead of by a Studio manual, and a foreign host can compute `explicitHiFi`
 * from a module it is actually told about.
 *
 * That second point was a real seam bug, not tidiness: `shouldSuppressWholeFrame`
 * required a value the host had no audited way to produce, so a host would pass
 * the plausible default `false` and silently get different routing from Studio on
 * the same prompt (spec review, 2026-08-06).
 *
 * `fidelityDirective.ts` re-exports both symbols, so every existing call site and
 * test is untouched. Pure — no I/O, no imports at all.
 */

/**
 * Phrases a designer uses when they want an exact match rather than a quick
 * sketch. Matched case-insensitively anywhere in the prompt. Deliberately
 * tight: a false positive only makes ONE turn slower + more accurate (rarely
 * unwanted), but the set avoids generic words like "match" alone that would
 * fire on "match the brand colors" style asks.
 */
export const HI_FI_PATTERNS: RegExp[] = [
  /pixel[-\s]?perfect/i,
  /\bprecise(?:ly)?\b/i,
  /\bexactly\b/i,
  /\bexact\s+(?:match|copy|replica|implementation)\b/i,
  /\bfaithful(?:ly)?\b/i,
  /\bto the pixel\b/i,
  /\b1[:\-]to[:\-]1\b/i,
  /\b1:1\b/,
  /\bhigh[-\s]?fidelity\b/i,
  /\bhi[-\s]?fi\b/i,
  /\bmatch(?:es|ing)?\s+(?:the\s+)?(?:design|figma|reference|mockup|spec)\s+(?:exactly|precisely)\b/i,
  // "dismiss/ignore/drop your template and implement … " — an explicit signal
  // that the designer does NOT want the speed shortcut, they want the real
  // design built. This is exactly how the SoR-nav prompts were phrased.
  /\b(?:dismiss|ignore|drop|forget|don'?t use)\b[^.]*\btemplate\b/i,
  /\bimplement\b[^.]*\b(?:precisely|exactly|as[-\s]is|as shown|to spec)\b/i,
];

/**
 * True when the prompt asks for an exact/precise Figma implementation. The
 * caller has already confirmed a Figma URL is present; this only judges
 * intent, so the directive is gated on (URL ∧ intent).
 */
export function detectHiFiIntent(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  return HI_FI_PATTERNS.some((re) => re.test(prompt));
}
