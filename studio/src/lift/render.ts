// studio/src/lift/render.ts
//
// Render a Manifest to (a) XML for agent consumption and (b) JSON for
// programmatic consumers. Both are pure string output — no I/O.
//
// The XML form is the primary artifact and what gets pasted into Claude
// Code. XML-tagged sections are what Anthropic recommends for structured
// prompt context; Claude extracts named sections from XML more reliably
// than from markdown headings. Section order matches spec §4.2.

import { applicableConventions, type Convention } from "./conventions";
import { buildRenderHarness } from "./renderHarness";
import type { Manifest, MappingEntry, ScaffoldingItem } from "./types";

export function renderXml(m: Manifest): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(
    `<lift_manifest schema_version="${m.schemaVersion}" project="${attr(m.projectSlug)}" frame="${attr(m.frameSlug)}" shape="${attr(m.shape)}">`,
  );
  push(`  <generated_by>Arcade Studio</generated_by>`);
  push(`  <frame_path>${text(m.frameAbsPath)}</frame_path>`);

  // 1. Intent
  push(`  <intent>${text(m.intentSummary || "(no prompt recorded — intent is implicit from frame code.)")}</intent>`);

  // 2. Conventions — the "rules" side of the rules-over-tables architecture.
  // Emitted BEFORE the inventory so the agent reads the translation
  // strategy before scanning specific mappings.
  const importedNames = new Set<string>();
  for (const i of m.imports) for (const n of i.names) importedNames.add(n);
  const conventions = applicableConventions({
    hasIcons: m.iconImports.length > 0,
    importedNames,
    hasOverlay: m.hasOverlay,
    hasInlineStyleTokens: m.hasInlineStyleTokens,
  });
  for (const c of conventions) push(renderConvention(c));

  // 3. Frame inventory — mappings + non-icon unmapped. Icons get their own
  // block below because the icon convention absorbs them and mixing would
  // make the dead-end "surface to reviewer" text leak back into the output.
  const hasInventory = m.mappings.length > 0 || m.unmapped.length > 0;
  if (!hasInventory) {
    push(`  <frame_inventory empty="true"/>`);
  } else {
    push(`  <frame_inventory>`);
    for (const e of m.mappings) push(renderMapping(e));
    for (const u of m.unmapped) {
      push(`    <unmapped studio_source="${attr(u.source)}" studio_name="${attr(u.name)}">`);
      push(`      <note>No mapping entry. Apply the default_mapping_convention above; if the symbol is absent from the target, surface to reviewer.</note>`);
      push(`    </unmapped>`);
    }
    push(`  </frame_inventory>`);
  }

  // 3b. Icons. Listed verbatim; the icon_convention tells the agent how to
  // resolve each via ICON_TYPES. No per-icon mapping table — that's the
  // point of the conventions architecture.
  if (m.iconImports.length > 0) {
    push(`  <icons resolve_via="icon_convention">`);
    for (const i of m.iconImports) {
      push(`    <icon studio_name="${attr(i.name)}"/>`);
    }
    push(`  </icons>`);
  }

  // 4. Tokens — emitted ONLY when at least one patch matched the frame
  // source. When arcade-gen and devrev-web finally converge, these all
  // sunset and the element disappears entirely, which is the point.
  if (m.tokenPatches.length > 0 || m.classPatches.length > 0) {
    push(`  <tokens alignment="patching">`);
    push(
      `    <note>Some arcade-gen names don't resolve in devrev-web yet. Rewrite the following when lifting:</note>`,
    );
    for (const p of m.tokenPatches) {
      const reason = p.reason ? ` reason="${attr(p.reason)}"` : "";
      push(
        `    <patch kind="css_var" studio="${attr(p.studio)}" production="${attr(p.production)}"${reason}/>`,
      );
    }
    for (const p of m.classPatches) {
      const reason = p.reason ? ` reason="${attr(p.reason)}"` : "";
      push(
        `    <patch kind="class" studio="${attr(p.studio)}" production="${attr(p.production)}"${reason}/>`,
      );
    }
    push(`  </tokens>`);
  }

  // 5. Scaffolding
  push(`  <scaffolding shape="${attr(m.shape)}">`);
  push(`    <description>These are the things a Studio frame never covers by itself. Engineer and agent divide between them.</description>`);
  for (const it of m.scaffolding) push(renderScaffolding(it));
  push(`  </scaffolding>`);

  // 6 / 7. Grounding
  if (m.figmaUrl || m.screenshotUrl) {
    push(`  <grounding>`);
    if (m.figmaUrl) push(`    <figma_url>${text(m.figmaUrl)}</figma_url>`);
    if (m.screenshotUrl) push(`    <screenshot_url>${text(m.screenshotUrl)}</screenshot_url>`);
    push(`  </grounding>`);
  }

  // 7b. Render harness — agent-facing checklist for a live-render verify
  // pass. Always emitted; conditional checks inside adapt to which
  // conventions fired. Added 2026-05-13 after a live render loop on
  // 01-skills-gallery showed typecheck alone can't catch token-fallthrough
  // bugs that only appear in computed styles.
  const harness = buildRenderHarness(m);
  push(`  <render_harness>`);
  push(`    <target_path>${text(harness.targetPath)}</target_path>`);
  push(`    <iframe_url>${text(harness.iframeUrl)}</iframe_url>`);
  push(`    <story_scaffold>${text(harness.storyScaffold)}</story_scaffold>`);
  push(`    <backdrop_note>${text(harness.backdropNote)}</backdrop_note>`);
  push(`    <checks>`);
  for (const c of harness.checks) {
    push(`      <check>${text(c)}</check>`);
  }
  push(`    </checks>`);
  push(`  </render_harness>`);

  // 8. Agent directives
  push(`  <agent_directives>`);
  push(
    `    You are lifting an Arcade Studio frame into devrev-web. Read the ` +
      `CONVENTIONS first — they tell you HOW to translate classes of Studio ` +
      `construct (icons, chrome, unmapped components, inline style tokens). ` +
      `Then walk the frame inventory: apply MECHANICAL rewrites directly; ` +
      `for CLOSE-BUT-NOT-IDENTITY entries treat the propDeltas and slotNotes ` +
      `as load-bearing — the surface looks identity-1:1 but a bare rename ` +
      `will not compile or will render wrong, so follow the per-delta note ` +
      `verbatim (wrap the callback, reach for the arbitrary-value class, ` +
      `etc.); write the production shape for STRUCTURAL ones with a brief ` +
      `comment on what changed; and leave // TODO comments with the ` +
      `judgment_note verbatim for JUDGMENT entries. When a mapping includes ` +
      `&lt;prior_art&gt;, OPEN the first example file before writing code — ` +
      `it's a real consumer and will resolve most shape questions faster ` +
      `than slot_notes can. When a mapping lists &lt;dropped_props&gt;, those ` +
      `Studio props have no production equivalent — don't guess a ` +
      `replacement; drop them with the reason as a TODO comment. For each ` +
      `icon under &lt;icons&gt;, resolve via the icon_convention (grep ` +
      `ICON_TYPES). For each &lt;unmapped/&gt; entry, apply the ` +
      `default_mapping_convention — verify the assumed target exists by grep ` +
      `before using it. If &lt;style_attribute_convention&gt; fired, every ` +
      `inline style={{ ... var(--...) ... }} in the frame source must be ` +
      `rewritten per that convention's anchors — leaving them intact will ` +
      `produce black borders or transparent backgrounds at render time. If ` +
      `&lt;render_harness&gt; is present, after writing the lift you MUST ` +
      `produce a LIVE render and read computed styles — static grep that a ` +
      `class "resolves" is NOT acceptable verification (a class string can ` +
      `exist and still paint nothing). Follow &lt;story_scaffold&gt; ` +
      `verbatim: it gives the exact globbed+themed directory, the paired ` +
      `story file, the launch command, and the predicted iframe URL — there ` +
      `is no "bare tmp/lift file has no story" excuse. Navigate the iframe ` +
      `URL and verify every check against live getComputedStyle output ` +
      `before declaring the lift done.`,
  );
  push(`  </agent_directives>`);

  push(`</lift_manifest>`);
  return lines.join("\n") + "\n";
}

function renderConvention(c: Convention): string {
  const lines: string[] = [];
  lines.push(`  <${c.tag}>`);
  lines.push(`    <rule>${text(c.rule)}</rule>`);
  lines.push(`    <lookup>${text(c.lookup)}</lookup>`);
  if (c.anchors.length > 0) {
    lines.push(`    <anchors>`);
    for (const a of c.anchors) lines.push(`      <anchor>${text(a)}</anchor>`);
    lines.push(`    </anchors>`);
  }
  lines.push(`  </${c.tag}>`);
  return lines.join("\n");
}

function renderMapping(e: MappingEntry): string {
  const prodAttrs =
    e.production.source === "n/a"
      ? `equivalent="none"`
      : `production_source="${attr(e.production.source)}" production_name="${attr(e.production.name)}"`;
  const openAttrs = `class="${attr(e.translationClass)}" studio_source="${attr(e.studio.source)}" studio_name="${attr(e.studio.name)}" ${prodAttrs}`;

  const children: string[] = [];
  for (const d of e.propDeltas) {
    // Identity entries (foo->foo) carry no translation information; strip
    // them before rendering. An entry that's entirely identity collapses to
    // no value_map attribute at all. Follow-up #3 from the 2026-05-05 doc.
    const nonIdentityEntries = d.valueMap
      ? Object.entries(d.valueMap).filter(([k, v]) => k !== v)
      : [];
    const valueMap =
      nonIdentityEntries.length > 0
        ? nonIdentityEntries.map(([k, v]) => `${k}->${v}`).join(", ")
        : null;
    const deltaAttrs = [
      `from="${attr(d.from)}"`,
      d.from !== d.to ? `to="${attr(d.to)}"` : null,
      valueMap ? `value_map="${attr(valueMap)}"` : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (d.note) {
      children.push(`      <prop_delta ${deltaAttrs}>${text(d.note)}</prop_delta>`);
    } else {
      children.push(`      <prop_delta ${deltaAttrs}/>`);
    }
  }
  for (const note of e.slotNotes) {
    children.push(`      <slot_note>${text(note)}</slot_note>`);
  }
  if (e.judgmentNote) {
    children.push(`      <judgment_note>${text(e.judgmentNote)}</judgment_note>`);
  }
  if (e.priorArt && e.priorArt.length > 0) {
    // Anchor(s) in real devrev-web files. The agent directive instructs
    // the reader to open the first one before translating.
    children.push(`      <prior_art>`);
    for (const ex of e.priorArt) {
      children.push(
        `        <example path="${attr(ex.path)}" covers="${attr(ex.covers)}"/>`,
      );
    }
    children.push(`      </prior_art>`);
  }
  if (e.droppedStudioProps && e.droppedStudioProps.length > 0) {
    // Props that exist in Studio but have no production equivalent.
    // Surfaced so the agent doesn't drop them silently (live-lift
    // validation caught this twice on Chip.appearance).
    children.push(`      <dropped_props>`);
    for (const d of e.droppedStudioProps) {
      children.push(
        `        <prop name="${attr(d.prop)}">${text(d.reason)}</prop>`,
      );
    }
    children.push(`      </dropped_props>`);
  }

  // Mappings with no children (pure 1:1 renames) collapse to a self-closing
  // tag so the output stays scan-friendly.
  if (children.length === 0) {
    return `    <mapping ${openAttrs}/>`;
  }
  return [`    <mapping ${openAttrs}>`, ...children, `    </mapping>`].join("\n");
}

function renderScaffolding(it: ScaffoldingItem): string {
  const attrs = [`status="${attr(it.status)}"`, it.pathPattern ? `path="${attr(it.pathPattern)}"` : null]
    .filter(Boolean)
    .join(" ");
  return `    <item ${attrs}>${text(it.label)}</item>`;
}

// Minimal XML escaping. Values destined for element text are passed through
// `text()`; values destined for attribute values go through `attr()`. We
// never embed raw CDATA — Studio-authored content doesn't contain the
// pathological cases CDATA is for, and CDATA sections inside attributes
// aren't valid XML anyway.
function text(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function attr(s: string): string {
  return text(s).replace(/"/g, "&quot;");
}

export function renderJson(m: Manifest): string {
  return JSON.stringify(m, null, 2);
}
