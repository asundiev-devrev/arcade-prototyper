// studio/src/lift/renderHarness.ts
//
// Build a <render_harness> block for the manifest. The idea is to close
// the loop at the cheapest possible point: after the agent writes code,
// it should actually render the result in a browser and read computed
// styles, not just typecheck. A single convention block can't prescribe
// this well because verification instructions depend on which OTHER
// conventions fired — a frame with inline style tokens needs a different
// checklist than one with hand-rolled overlays.
//
// Deliberately target-codebase-agnostic: the harness names a `tmp/lift`
// scratch path, a `{frameSlug}` URL placeholder, and an `hsl(var(--X))`
// backdrop hint. Consumers running lifts against a non-Storybook target
// can ignore the targetPath and iframeUrl and still get the checklist.
//
// Added 2026-05-13 after a live render loop on 01-skills-gallery
// surfaced three classes of bug that text-level review had missed.

import type { Manifest, RenderHarness } from "./types";

export function buildRenderHarness(m: Manifest): RenderHarness {
  const targetPath = `tmp/lift/${m.frameSlug}.tsx`;

  const iframeUrl =
    "(target dev server URL pointing at the lifted component — e.g. a " +
    "Storybook `iframe.html?id=<story-id>&viewMode=story` URL; failing " +
    "that, whatever URL serves the component in isolation)";

  const backdropNote =
    "Wrap the rendered story in a decorator that gives it a non-white " +
    "backdrop — many DS border tokens resolve to near-white (e.g. " +
    "`#FAFAFA`) and will vanish against a pure-white iframe. A simple " +
    '`<div className="min-h-screen bg-[hsl(var(--bg-surface-shallow))]">` ' +
    "wrapper is enough when the target codebase's tokens are raw HSL " +
    "channels; if the token is already a full color, omit the `hsl()` " +
    "wrap.";

  const checks: string[] = [
    "No browser console errors or unresolved React errors on first mount.",
    "For each card/container, computed `borderColor` is a real color (not transparent, not `rgb(0,0,0)`/near-black). Near-black borders on a light-theme render almost always mean a token fell through to Tailwind's `currentColor` default.",
    "For each element that Studio gave a `background`, computed `backgroundColor` is NOT `rgba(0, 0, 0, 0)` (transparent) unless the Studio source was also transparent. A transparent background usually means a theme variable was embedded inline as a raw HSL triple and silently invalidated.",
    "Active/selected states (e.g. tab underline, button hover) render visibly. If the active tab has the same color as an inactive tab, a state token didn't resolve.",
  ];

  // Conditional checks — only add when a convention that produces this
  // class of bug has fired. Keeps the list short and actionable per-frame.
  if (m.hasInlineStyleTokens) {
    checks.push(
      "Every `style={{ ... var(--X) ... }}` in the Studio source was rewritten per `style_attribute_convention`; grep the lifted file for `style={{` and confirm none of the remaining ones reference a `var(--bg-|--fg-|--stroke-|--border-|--color-)`.",
    );
    checks.push(
      "Spot-check any container's computed `borderColor` and `backgroundColor`: both must resolve to `rgb(...)` values with matching hex digits to the Figma source, not fall back to text color. A good evaluate to paste in DevTools: `getComputedStyle($0).borderTopColor`.",
    );
  }
  if (m.hasOverlay) {
    checks.push(
      "The overlay is driven by `<Modal open={...} onOpenChange={...}>` from the target DS, NOT by preserved `fixed inset-0` divs. Grep the lifted file for `fixed inset-0` — zero matches expected.",
    );
  }
  if (m.iconImports.length > 0) {
    checks.push(
      "Every icon in the lifted file uses the target DS's icon enum (e.g. `ICON_TYPES.X`) — NOT the Studio-source named icon component (e.g. `<LightingBolt/>`). Grep the lifted file for the Studio-source icon names — zero matches expected.",
    );
  }
  // close-but-not-identity mappings almost always need a wrapper (Radix-
  // style optional-arg callbacks, onChange signature narrowing, etc.).
  // Make the agent confirm per-delta notes were actually applied.
  const closeEntries = m.mappings.filter(
    (e) => e.translationClass === "close-but-not-identity",
  );
  if (closeEntries.length > 0) {
    const names = closeEntries.map((e) => e.studio.name).join(", ");
    checks.push(
      `For each close-but-not-identity mapping (${names}), confirm the propDeltas' "wrap" / "narrow" guidance was applied verbatim at every call site. A bare setState or identity handler will typecheck-fail or render wrong.`,
    );
  }

  return { targetPath, iframeUrl, backdropNote, checks };
}
