/**
 * High-fidelity Figma mode.
 *
 * Studio's generator is tuned for FAST, rough prototypes — it injects a
 * compacted `<figma_context>` summary tree + a thumbnail and tells the agent
 * NOT to re-read Figma or verify its own output ("the designer will iterate").
 * That is the right default for "sketch me a dashboard", but it fights a
 * prompt like "implement this Figma precisely / pixel-perfect": the agent
 * transcribes the lossy summary, never opens the real file, and ships a frame
 * with the wordmark collapsed to a generic glyph, phantom icons the render
 * doesn't show, wrong icon sizes, and guessed spacing.
 *
 * When the prompt carries a Figma URL AND fidelity intent, we append a
 * directive that SUSPENDS the speed shortcuts for that one turn: read the real
 * node tree, treat the high-res PNG as ground truth, distrust the summary, and
 * self-review against the reference before finishing.
 *
 * Pure functions only — detection is keyword-based and the directive is a
 * template string, so both are trivially unit-testable.
 */

/**
 * Phrases a designer uses when they want an exact match rather than a quick
 * sketch. Matched case-insensitively anywhere in the prompt. Deliberately
 * tight: a false positive only makes ONE turn slower + more accurate (rarely
 * unwanted), but the set avoids generic words like "match" alone that would
 * fire on "match the brand colors" style asks.
 */
const HI_FI_PATTERNS: RegExp[] = [
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

export interface HiFiGateContext {
  /** Whether the phase-2 classifier has actually run for this node. Composites
   *  start empty because the classifier is a background phase — an empty list
   *  means "not classified yet", NOT "no template matched", so we must not
   *  treat the first turn's empty list as a novel-design signal. */
  classified: boolean;
  /** Whether a high-confidence template/composite was matched. */
  hasHighConfidenceComposite: boolean;
}

/**
 * Decide whether to run high-fidelity mode for this turn.
 *
 * Fires when EITHER:
 *  - the prompt has explicit precise-implementation intent (keyword match), OR
 *  - this is a NOVEL design: the classifier has run AND found no high-confidence
 *    template to iterate on. That is exactly the "exploring a new direction"
 *    case that produces poor frames and churns the designer to Cursor — even
 *    when they didn't think to say "precisely".
 *
 * Does NOT fire before classification (avoids misfiring on every first turn,
 * when composites are empty only because phase 2 hasn't finished).
 */
export function shouldUseHiFi(prompt: string, ctx: HiFiGateContext): boolean {
  if (detectHiFiIntent(prompt)) return true;
  return ctx.classified && !ctx.hasHighConfidenceComposite;
}

export interface HiFiDirectiveContext {
  /** Figma file key, already parsed from the URL. */
  fileKey: string;
  /** Node id, already parsed (colon form; figmanage accepts `:` or `-`). */
  nodeId: string;
  /** Whether a reference PNG was attached to the prompt by the ingest. When
   *  false, the directive tells the agent to export its own. */
  hasReferencePng: boolean;
}

/**
 * Build the `<high_fidelity_mode>` directive appended after the
 * `<figma_context>` block. Every line targets a concrete failure we have
 * observed on real "implement this precisely" turns:
 *   - wordmark/logo collapsed to anonymous vectors → rendered as a tiny glyph
 *   - phantom icons/rows present in the summary tree but not in the render
 *   - icon sizes guessed (20px in a 16px slot)
 *   - hand-rolled SVG for an icon the kit already exports
 *   - spacing/truncation guessed from the 240px thumbnail
 *   - never opening the real file because the summary "felt complete"
 */
export function buildHiFiDirective(ctx: HiFiDirectiveContext): string {
  const pngLine = ctx.hasReferencePng
    ? "The attached high-resolution PNG of the frame — this is what the designer sees and what \"looks right\" means."
    : "A high-resolution PNG render of the frame. Export it first: `figmanage export nodes --format png --scale 2 --json " +
      ctx.fileKey + " " + ctx.nodeId + "`, then fetch the URL with curl and Read the PNG.";

  return [
    "<high_fidelity_mode>",
    "This is a PRECISE Figma implementation. The designer asked for an exact match, so the",
    "speed-first shortcuts in your instructions are SUSPENDED for this turn — accuracy beats",
    "speed here, and \"the designer will iterate\" does NOT apply.",
    "",
    "GROUND TRUTH, in priority order:",
    `1. ${pngLine}`,
    "   When anything below disagrees with the PNG, the PNG wins.",
    "2. The REAL Figma node tree, which you MUST read this turn. Do NOT rely on the",
    "   <figma_context> summary above — it is LOSSY and is the #1 cause of wrong frames:",
    `       figmanage reading get-nodes --depth 4 ${ctx.fileKey} ${ctx.nodeId}`,
    "   Drill into one subtree with a single focused deeper read only where a section is unclear.",
    "",
    "USE THE STRUCTURED DATA in <figma_context>: each node carries @[x,y,w,h] geometry in DESIGN PX",
    "(the real coordinate map — use it for widths, positions, and spacing, not eyeballed guesses from the",
    "thumbnail), and every instance carries its component identity as \"Component Name\" {variant props}.",
    "Map each such component to the matching kit leaf — do not re-derive it from raw shapes.",
    "",
    "\"DISMISS / DROP THE TEMPLATE\" means: do NOT reach for the MACRO LAYOUT composite (e.g. NavSidebar,",
    "SettingsPage) — build the novel macro layout yourself from a bare div + flex using the @[x,y,w,h]",
    "geometry. It does NOT mean hand-roll every atom. Every LEAF still maps to a kit component: each row,",
    "icon, avatar, button, chip, separator → the matching kit export (IconButton, Avatar, Separator, the",
    "icon barrel, …). A hand-rolled <svg> for an icon the kit has, or a raw <div> where a kit leaf existed,",
    "is a FAILURE even in high-fidelity mode.",
    "",
    "The <figma_context> tree above is a COMPACTED SUMMARY. Known ways it misleads you — check each:",
    "- WORDMARKS / LOGOS collapse to an anonymous cluster of `vector` nodes (e.g. a node named",
    "  \"…/Logo\" holding several vectors and no text). That is a brand WORDMARK, not an icon —",
    "  render the actual wordmark/text the PNG shows. NEVER substitute a single generic icon glyph",
    "  (a small monitor, a box, etc.) for a wordmark.",
    "- HIDDEN nodes (hidden=true) and zero-size nodes appear in the summary but are NOT visible.",
    "  Build only what is actually visible in the PNG. If the tree lists an icon or row the PNG",
    "  does not show, OMIT it — do not transcribe the tree blindly.",
    "- ICON SIZES match the design: a 16px icon in a 20px slot is size 16, not 20.",
    "- ICON NAMES map to a real kit export that you IMPORT — never hand-roll an SVG for an icon the",
    "  kit already has. Common maps: Icons/Window → Window, Icons/Magnifying.glass.in.square →",
    "  MagnifyingGlassInSquare, Icons/Bell → Bell, a \"Chat\" glyph → ChatBubble,",
    "  Icons/Arrow.pointing.into.tray → ArrowPointingIntoTray. If a name isn't obvious, read the",
    "  icon barrel once and use the exact export.",
    "- SPACING, WIDTHS, and TRUNCATION come from the real node geometry, not the thumbnail.",
    "",
    "BEFORE YOU FINISH (this overrides the rule against verifying your own output):",
    "Read the reference PNG and your written JSX side by side and verify, section by section:",
    "  · the header/wordmark renders as in the PNG (not a stand-in glyph),",
    "  · each section has the SAME number of rows, same order, as the PNG,",
    "  · icons appear only where the PNG shows them, at the right size,",
    "  · the footer matches (avatar, name, trailing control).",
    "Fix every mismatch in THIS turn.",
    "",
    "Still in force: closed-world imports (arcade/components + arcade-prototypes only), design",
    "tokens (no raw Tailwind brackets / hex), and an honest ### Deviations section.",
    "</high_fidelity_mode>",
  ].join("\n");
}
