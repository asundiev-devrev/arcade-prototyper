// studio/src/lift/wrapPrompt.ts
//
// Wraps a rendered lift manifest in a prompt the user can paste straight
// into Claude Code. Before 0.16.1, "Copy Lift Manifest" clipboarded the
// raw XML and the beta tester had to hand-write the instructions that go
// around it. Now we ship both together.
//
// Design notes:
//   - The prompt is codebase-agnostic. It references `frame_path`,
//     `frame_inventory`, conventions, etc. via the manifest's own tag
//     names; it never names devrev-web specifically. That way it works
//     when someone points it at a different target repo (which is the
//     eventual product posture even though devrev-web is the only
//     consumer today).
//   - The target file path is left as a placeholder because the user's
//     target repo structure is unknown. `tmp/lift-output/<frame>.tsx`
//     is a reasonable neutral default.
//   - Everything the agent needs from the manifest is IN the manifest.
//     The prompt tells it what to READ; it doesn't duplicate the
//     content.
//
// Pure function, no DOM / clipboard / I/O. Callers (ShareModal) wrap it
// with clipboard.writeText.

export interface WrapPromptOptions {
  /** The full rendered XML manifest. Pasted verbatim inside a fenced block. */
  manifestXml: string;
  /** Frame slug, used to suggest a scratch filename. */
  frameSlug: string;
}

export function wrapManifestWithPrompt({ manifestXml, frameSlug }: WrapPromptOptions): string {
  const targetFile = `tmp/lift/${frameSlug}.tsx`;

  return `I want you to lift an Arcade Studio frame into this codebase, following the lift manifest below verbatim.

**Target file:** write the lifted frame to \`${targetFile}\`. Create the directory if needed. Do NOT modify anything else in the repo. Do NOT register the file in a router, data layer, or i18n — this is a translation experiment, not a feature ship.

**What to do:**

1. Read the manifest's conventions (icon_convention, chrome_convention, overlay_convention if present, default_mapping_convention) BEFORE anything else. They tell you HOW to translate whole classes of Studio construct.
2. Walk the \`<frame_inventory>\` once, top to bottom.
   - For MECHANICAL mappings: apply directly.
   - For STRUCTURAL mappings: write the production shape and leave a short comment on what changed.
   - For JUDGMENT entries (\`class="judgment"\`): leave a \`// TODO:\` comment carrying the \`judgment_note\` verbatim. Do not invent a production equivalent.
3. When a mapping has \`<prior_art>\`: OPEN the first example file before writing code for that mapping. The slot notes describe shape; the prior-art file shows the shape in use.
4. When a mapping has \`<dropped_props>\`: each listed prop exists in Studio but has no production equivalent. Drop it with a TODO comment carrying the reason verbatim. Don't invent a replacement.
5. For every entry in \`<icons>\`: resolve via the icon_convention. Grep \`ICON_TYPES\` in the target icon module for the closest semantic match. Don't guess. If a Studio icon passes \`color\`, follow the convention's COLOR guidance — don't forward the prop; wrap the icon in a parent whose text color sets \`currentColor\`.
6. For every \`<unmapped/>\` entry: apply the default_mapping_convention — grep the target to verify the symbol exists before using it. If absent, TODO.
7. If \`<tokens alignment="patching">\` appears: each \`<patch>\` entry names an arcade-gen token or class that doesn't resolve in the target. Rewrite to the \`production\` value everywhere it appears in the lift.
8. If \`<overlay_convention>\` is present: the frame has hand-rolled overlay markup (fixed inset-0 + backdrop). Follow the convention's lookup and anchors — do NOT preserve the raw-div overlay.
9. Read the studio source frame at the \`<frame_path>\` listed in the manifest — it's the actual source the manifest was generated from.

**Don't:**

- Don't invent production components, hooks, or paths. Everything you import must resolve to a real export — verify by reading or grepping.
- Don't wire up the \`<scaffolding>\` items (data-layer hook, adapter, route, flag, tracker). Note them in a comment at the top of the file, but don't create those files — out of scope for this experiment.
- Don't reach for \`react-router\` or similar routing if the manifest says "judgment" for \`FrameLink\` — leave a TODO instead.

**When done:** print a short summary — how many TODOs you left, what each represents, and anything the manifest told you but didn't give you enough to act on. The gaps section is the most valuable thing you can report.

Here's the manifest:

\`\`\`xml
${manifestXml.trim()}
\`\`\`
`;
}
