// studio/src/lift/render.ts
//
// Render a Manifest to (a) XML for agent consumption and (b) JSON for
// programmatic consumers. Both are pure string output — no I/O.
//
// The XML form is the primary artifact and what gets pasted into Claude
// Code. XML-tagged sections are what Anthropic recommends for structured
// prompt context; Claude extracts named sections from XML more reliably
// than from markdown headings. Section order matches spec §4.2.

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

  // 2. Frame inventory
  if (m.mappings.length === 0 && m.unmapped.length === 0) {
    push(`  <frame_inventory empty="true"/>`);
  } else {
    push(`  <frame_inventory>`);
    for (const e of m.mappings) push(renderMapping(e));
    for (const u of m.unmapped) {
      push(`    <unmapped studio_source="${attr(u.source)}" studio_name="${attr(u.name)}">`);
      push(`      <note>No mapping entry — surface to reviewer; add to mapping table after lift.</note>`);
      push(`    </unmapped>`);
    }
    push(`  </frame_inventory>`);
  }

  // 4. Tokens
  push(`  <tokens alignment="aligned">Tokens are aligned between arcade-gen and arcade-theme. CSS custom property names carry across. No token remap is required.</tokens>`);

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

  // 8. Agent directives
  push(`  <agent_directives>`);
  push(
    `    You are lifting an Arcade Studio frame into devrev-web. Apply MECHANICAL rewrites ` +
      `directly. For STRUCTURAL rewrites, write the new production shape and leave brief ` +
      `comments explaining what changed. For JUDGMENT entries, leave a // TODO: comment ` +
      `carrying the judgment note verbatim and ask the user before deciding. Do NOT invent ` +
      `production equivalents for &lt;unmapped/&gt; entries — surface them back to the user.`,
  );
  push(`  </agent_directives>`);

  push(`</lift_manifest>`);
  return lines.join("\n") + "\n";
}

function renderMapping(e: MappingEntry): string {
  const prodAttrs =
    e.production.source === "n/a"
      ? `equivalent="none"`
      : `production_source="${attr(e.production.source)}" production_name="${attr(e.production.name)}"`;
  const openAttrs = `class="${attr(e.translationClass)}" studio_source="${attr(e.studio.source)}" studio_name="${attr(e.studio.name)}" ${prodAttrs}`;

  const children: string[] = [];
  for (const d of e.propDeltas) {
    const valueMap = d.valueMap
      ? Object.entries(d.valueMap)
          .map(([k, v]) => `${k}->${v}`)
          .join(", ")
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
