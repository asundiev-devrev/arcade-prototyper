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
 *
 * DETECTION MOVED OUT, DIRECTIVE TEXT STAYED (2026-08-06). `HI_FI_PATTERNS` and
 * `detectHiFiIntent` now live in the zero-import leaf `server/figma/hiFiIntent.ts`
 * because the ROUTING layer needs the answer and the routing layer is BRAIN — code
 * that must load in Claude Code / Cursor / Computer with no Studio around it. The
 * text below is the part that cannot travel: it names the `figmanage` CLI, a binary
 * no foreign host has. They are re-exported from here so every existing call site
 * and test is unchanged; see hiFiIntent.ts for the full reasoning.
 */
export { HI_FI_PATTERNS, detectHiFiIntent } from "./hiFiIntent";
import { detectHiFiIntent } from "./hiFiIntent";

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

/**
 * Directive for a SCOPED EDIT that references one or more Figma designs.
 *
 * The whole-frame `buildHiFiDirective` is wrong here: it tells the agent to
 * reproduce "every section of the frame, same number of rows as the PNG",
 * which assumes each reference IS a full frame. On a scoped edit the references
 * are PARTS — a popover, a menu, a panel, a state — that the request wires into
 * an EXISTING frame. Observed failure (implement-this-precisely-3): asked to
 * add a filter popover whose design shows 4 items (Created Date / Created By /
 * Brand / Team), the agent instead duplicated the frame body's own 8-row
 * knowledge list into the popover. It had the correct 4 labels in both the
 * reference tree and PNG and ignored them.
 *
 * This directive reframes the references as source-of-truth for the specific
 * parts they depict and forbids copying the existing frame's content into them.
 *
 * It also forbids the OTHER failure family we saw on the same flow
 * (implement-this-precisely): with the labels finally correct, the agent then
 * EMBELLISHED beyond the reference and RESTRUCTURED the host frame. It added
 * leading "+" icons to every menu row, a "ChevronRight" marker on selected
 * rows, and an invented "Apply Filters" button + separator — none of which are
 * in the reference (the popover is four plain text rows). It hand-rolled the
 * multi-select marker instead of using the kit's Menu.CheckboxItem (which
 * renders the standard checkmark). And to fit the new filter pills it recomputed
 * the toolbar's absolute offsets, sliding the existing search / sort / trigger
 * controls to the centre and shoving the dropdown off-screen. So the directive
 * now also says: invent nothing the reference doesn't show, match the exact
 * state marker, prefer the kit's purpose-built primitive, and don't reposition
 * the host frame's existing controls.
 */
export function buildScopedEditReferenceDirective(): string {
  return [
    "<edit_reference_designs>",
    "The Figma design(s) attached above are REFERENCE for the specific PART(s) of this",
    "element the request describes — a popover, menu, panel, dropdown, or state. They are",
    "NOT whole frames to reproduce, and this is an EDIT of an existing frame, not a fresh build.",
    "",
    "- Each <figma_context url=\"…\"> block is the SOURCE OF TRUTH for the part the request",
    "  ties to that SAME url (\"the popover looks like <urlA>\", \"the menu like <urlB>\").",
    "  Build that part's contents — its items, their labels, their order, and HOW MANY there",
    "  are — from that reference, NOT from the frame you are editing.",
    "- Do NOT duplicate the existing frame's rows / list / content to fill a referenced part.",
    "  A menu that repeats the list already on the frame is WRONG — the reference shows what",
    "  the menu actually contains, which is usually different and shorter (e.g. a filter menu",
    "  lists filter DIMENSIONS like \"Created Date / Created By / Brand\", not the frame's data rows).",
    "- Take the exact item text from the reference's node-tree `text=` fields; use its PNG for",
    "  layout, spacing, and which items exist. If the reference shows 4 items, build exactly 4 —",
    "  do not pad it to match the frame's count.",
    "",
    "BUILD ONLY WHAT THE REFERENCE SHOWS — invent NOTHING extra:",
    "- Do NOT add icons, markers, buttons, separators, headers, or footers that the reference",
    "  does not contain. If the popover is four plain text rows, build four plain text rows — no",
    "  leading \"+\" glyph on each row, no trailing chevron, no invented \"Apply\" / \"Done\" / \"Clear\"",
    "  button, no separator. Extra chrome the design doesn't have is a hallucination, not a nicety.",
    "- Match the EXACT state indicator the reference uses. If selecting an item shows a CHECKMARK,",
    "  render a checkmark — never substitute a different glyph (a chevron, a plus, a dot) for it.",
    "- Use the kit's PURPOSE-BUILT primitive for the pattern rather than hand-rolling it. A",
    "  multi-select menu is Menu.CheckboxItem (it renders the standard checkmark on selection) —",
    "  not Menu.Item with your own icon bolted on. A single-select menu is Menu.RadioItem. Reach",
    "  for the component whose name matches the behaviour before assembling one from atoms.",
    "",
    "DON'T RESTRUCTURE THE HOST FRAME. You are inserting a part, not re-laying-out the toolbar:",
    "- Leave every EXISTING control where it already sits. Do NOT recompute or shift the absolute",
    "  positions of sibling elements (search, sort, the trigger button) to make room for new",
    "  content. Sliding the existing controls to the centre, or pushing the trigger/dropdown",
    "  off-screen, is a regression even if the new part itself looks right.",
    "- Add new elements (e.g. filter pills) in the location the reference shows them, without",
    "  moving what was already there. If they genuinely don't fit, keep the existing layout and",
    "  note it under ### Deviations — do not silently reflow the frame.",
    "",
    "- Everything else about the frame stays as-is. Change only what the request asks.",
    "</edit_reference_designs>",
  ].join("\n");
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
    : "A PNG render of the frame. Export it first: `figmanage export nodes --format png --scale 1 --json " +
      ctx.fileKey + " " + ctx.nodeId + "`, then fetch the URL with curl and Read the PNG. Use scale 1 — a full-scale export can exceed the 30s export timeout on large frames.";

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
    `       figmanage reading get-nodes --depth 2 ${ctx.fileKey} ${ctx.nodeId}`,
    "   Start shallow (depth 2). If figmanage output is large enough to be persisted to a",
    "   file (the tool tells you), do NOT Read the whole file — it will exceed the 256KB /",
    "   25K-token read cap and fail. Read it with offset/limit in chunks, or grep for the one",
    "   subtree you need, then drill into that single subtree with a focused deeper read.",
    "",
    "TEXT vs PIXELS — the PNG is legible for LAYOUT, STRUCTURE, and COLOR, but NOT for reading",
    "small body copy word-for-word. Take exact text content from the node tree's `characters`",
    "fields (read via the recipe above). Do NOT OCR / read text off the PNG. The PNG decides",
    "where things sit and what colour they are; the tree decides what they say.",
    "",
    "IF A FETCH FAILS (timeout, or output too large to read): do NOT give up and invent the UI.",
    "Retry shallower, and build from whatever portion of the PNG + tree you did read. A faithful",
    "partial beats a confident fabrication.",
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
