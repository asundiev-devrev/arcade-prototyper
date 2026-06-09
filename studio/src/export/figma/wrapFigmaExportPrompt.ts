// studio/src/export/figma/wrapFigmaExportPrompt.ts
//
// Wraps a frame reference in a prompt the user pastes into a Claude session
// that has the figma-console MCP Bridge connected. That session runs the
// hybrid Figma export (capture layout + swap real 0.3 component instances).
//
// Why a paste-prompt, not a one-click: the swap writes component INSTANCES
// into Figma, which requires the Figma desktop plugin Bridge (figma-console
// MCP). The Studio app is a localhost server with no path to that Bridge, so
// — exactly like "Copy Lift Manifest" — we hand the user a ready payload to
// run where the Bridge lives. A true in-app one-click needs Studio to host
// the Bridge WebSocket itself (a separate follow-up).
//
// Pure function, no DOM / clipboard / I/O. ShareModal wraps it with
// clipboard.writeText.

export interface WrapFigmaExportOptions {
  /** Frame slug being exported (e.g. "01-computer-with-panel"). */
  frameSlug: string;
  /** Project slug the frame belongs to. */
  projectSlug: string;
}

export function wrapFigmaExportPrompt({ frameSlug, projectSlug }: WrapFigmaExportOptions): string {
  const frameUrl = `http://localhost:5556/api/frames/${projectSlug}/${frameSlug}`;

  return `Export this Arcade Studio frame to Figma as real, editable DevRev components.

**Frame:** \`${frameSlug}\` (project \`${projectSlug}\`)
**Live frame URL:** ${frameUrl}

**Preconditions (the export needs these):**
- Figma desktop open on the Arcade UI Kit v0.3 library, with the **Desktop Bridge plugin running** (figma-console MCP connected). Verify with the bridge status tool before starting.
- The Studio dev server running on :5556 (so the frame URL above renders).

**What to do — the hybrid export (capture layout + swap components):**

1. **Serialize the live frame.** In the frame page, run \`exportFrameToSlj\` (reach the React root via \`#root\`'s \`__reactContainer$\` key — NOT by climbing \`.return\`, which lands on a stale StrictMode tree and drops the chat transcript). This produces the SLJ; flatten it with \`flattenManifest\` to get the component manifest (each entry carries component name, box, props, text, and — for IconButtons — the inner \`icon\` glyph name).
   - Make sure the kit \`dist\` is built (\`pnpm exec tsx studio/prototype-kit/scripts/build-package.mts\`) so sidebar rows report their qualified name, not bare \`Item\`.

2. **Capture the layout.** Use an HTML→Figma converter (Figma's \`generate_figma_design\`, or html.to.design) to capture the same frame URL into the 0.3 library file. This gives a pixel-faithful flat-frame tree. Clone it first so the pristine capture survives.

3. **Run the swap** (the proven pipeline in \`studio/src/export/figma/\`): \`buildSwapOps(slj, captureNodes, maps)\` then execute over the Bridge.
   - **Discrete components** (sidebar rows, buttons, icons, menu): geometry-match each manifest component to a capture flat frame (edge-distance, threshold 8, area ±25%, ambiguity guard) → replace with a real 0.3 instance at the matched box/parent. Apply variant props (variant/size). Set labels via the component's TEXT property (match by base name before \`#\`). For IconButtons, set the inner \`Icons/*\` child via \`swapComponent\` to a **locally-resolved** Size-matched variant (import-by-key fails on library drift — resolve the Icons/* set by local node id).
   - **Transcript**: find the transcript container by containment (its x-span covers the bubbles, top at/above the first, tightest such wrapper — NOT bbox match, since the SLJ has the full scrollback but the capture clips to the viewport). Clear its flat children, inject real ChatBubble instances (sender/receiver variant) positioned relative to the container.
   - **Instancing**: resolve every component-set key to a LOCAL node id and instance from the variant child (\`importComponentByKeyAsync\` hangs cross-file).

4. **Screenshot the result** and confirm: real sidebar Chat Item rows with titles + avatars, real ChatBubbles with the real conversation, real chevron/clock/send/add-collaborator glyphs, in the converter's faithful three-pane layout.

**Known caveats (don't be surprised):**
- The sidebar row maps to 0.3 "Chat Item", which the library currently marks deprecated — the DS nav system is mid-migration. Rows still render with their titles; re-curate when the replacement row is published.
- Icons not in the icon map (e.g. the window-dot toggles) keep the component's default glyph — acceptable degrade.
- Token/variable binding onto instances is not wired yet; instances inherit the converter's flat fills (which read correctly).

The full design + mechanism is in \`docs/superpowers/specs/2026-06-09-figma-export-hybrid-design.md\` and \`…-icon-capture-design.md\` if you need the details.`;
}
