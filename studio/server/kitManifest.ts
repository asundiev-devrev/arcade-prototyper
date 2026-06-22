/**
 * KIT-MANIFEST generator.
 *
 * Walks `studio/prototype-kit/composites/*.tsx` and `…/templates/*.tsx`,
 * extracts each export's *header* JSDoc (the comment block above the first
 * export) plus any top-level `type Xxx = { … }` / `interface Xxx { … }`
 * bodies referenced from the exported function's signature, and writes a
 * single human-readable `KIT-MANIFEST.md` next to the kit barrel.
 *
 * Why this file exists:
 * - The generator agent used to Read each composite source it intended to
 *   use (8-10 Reads per vista-like frame). Each Read is a Bedrock round-trip
 *   that can stall the turn. The manifest collapses those into ONE Read.
 * - Duplicating prop docs in CLAUDE.md.tpl would rot (docs drift from
 *   source). Generating from source means drift is impossible.
 *
 * Design decisions:
 * - Dependency-free regex parsing (no TypeScript AST). The kit files follow
 *   a narrow convention — one export per file, one header comment, one
 *   props type — so regexes are sufficient and avoid adding `typescript` as
 *   a runtime dependency. When the kit grows past what this can handle, the
 *   escape hatch is the "read the .tsx source" instruction that still lives
 *   in CLAUDE.md.tpl.
 * - Output is Markdown, not JSON — the agent reads it as prose the same way
 *   it reads CLAUDE.md.
 */
import fs from "node:fs/promises";
import path from "node:path";

export interface KitManifestEntry {
  kind: "composite" | "template";
  name: string;
  file: string; // relative path from prototype-kit/
  /** Header JSDoc body (between `/**` and `*\/`), stripped of leading ` * `
   *  and stripped of custom `@tag` blocks (which are surfaced separately). */
  doc: string;
  /** Raw source of the props type/interface, trimmed. */
  propsSource?: string;
  /** Exported compound subcomponent names (e.g. VistaRow.Header). */
  subcomponents: string[];
  /** Contents of `@counterexample` blocks in the header JSDoc. Each block
   *  is one "pick X instead when…" rule. Surfaced in the manifest as a
   *  "When NOT to use this" section. */
  counterexamples: string[];
  /** Contents of `@tokens` blocks in the header JSDoc. Freeform markdown
   *  — typically an Element → Token table — listing the design tokens the
   *  agent is likely to need when filling this composite's user slot.
   *  Only authored for composites with open-ended content zones. */
  tokens: string[];
}

/** Extract the leading header comment of a file — the `/** … *\/` that sits
 *  at file top (after imports are allowed). Returns the inner text with the
 *  `*` prefix stripped from each line. */
function extractHeaderDoc(source: string): string | null {
  // Match the first /** … */ that is preceded only by imports/blank lines.
  // We don't require the comment to be the very first bytes because the
  // "* @fileoverview" idiom places it under imports.
  const match = source.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return null;
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").replace(/^\s*\* /, ""))
    .join("\n")
    .trim();
}

/** Pull out `@<tag>` blocks from a stripped JSDoc body. A block is
 *  everything from a line starting with `@tag` up to the next `@tag` line
 *  or end of doc. Returns the matched blocks and the doc with those
 *  blocks removed. */
function extractTags(doc: string, tag: string): { blocks: string[]; rest: string } {
  const tagLine = new RegExp(`^@${tag}\\b[ \\t]*`, "m");
  const lines = doc.split("\n");
  const blocks: string[] = [];
  const keep: string[] = [];
  let inBlock = false;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length > 0) blocks.push(buf.join("\n").trim());
    buf = [];
  };
  for (const line of lines) {
    if (tagLine.test(line)) {
      flush();
      inBlock = true;
      buf.push(line.replace(tagLine, ""));
      continue;
    }
    // End the block when another @-tag line starts (don't capture it).
    if (inBlock && /^@[a-z][a-z0-9-]*\b/i.test(line)) {
      flush();
      inBlock = false;
      keep.push(line);
      continue;
    }
    if (inBlock) {
      buf.push(line);
    } else {
      keep.push(line);
    }
  }
  flush();
  return { blocks, rest: keep.join("\n").trim() };
}

/** Find the `type Props = { … }` / `interface Props { … }` declaration that
 *  immediately precedes or matches the exported function's signature. The
 *  kit convention is one props type per file, named `<Name>Props`. */
function extractPropsType(source: string, componentName: string): string | undefined {
  const typeName = `${componentName}Props`;
  // Match `type <Name>Props = {` with the matching balanced `}`, or
  // `interface <Name>Props {` followed by its body.
  const re = new RegExp(
    `(?:type|interface)\\s+${typeName}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`,
    "m",
  );
  const match = source.match(re);
  if (!match) return undefined;
  return match[0].trim();
}

/** Find compound subcomponents — the pattern `Object.assign(Root, { A, B, C })`
 *  at the bottom of each kit file. */
function extractSubcomponents(source: string): string[] {
  const match = source.match(/Object\.assign\([^,]+,\s*\{([\s\S]*?)\}\)/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Z][A-Za-z0-9]*$/.test(s));
}

/** Component name comes from the first exported function/const. */
function extractComponentName(source: string, file: string): string | null {
  const explicit =
    source.match(/^export\s+function\s+([A-Z][A-Za-z0-9]*)/m) ??
    source.match(/^export\s+const\s+([A-Z][A-Za-z0-9]*)/m) ??
    source.match(/^export\s+default\s+function\s+([A-Z][A-Za-z0-9]*)/m);
  if (explicit) return explicit[1];
  // Fallback: file basename without extension. Keeps the manifest useful
  // when a composite deviates from the convention.
  return path.basename(file, path.extname(file));
}

async function parseFile(file: string, kind: "composite" | "template"): Promise<KitManifestEntry | null> {
  const source = await fs.readFile(file, "utf-8");
  const name = extractComponentName(source, file);
  if (!name) return null;
  const rawDoc = extractHeaderDoc(source) ?? "";
  // Pull `@counterexample` and `@tokens` blocks out of the doc body so they
  // render as dedicated sections in the manifest. Each `@counterexample`
  // block becomes one bullet; each `@tokens` block becomes one freeform
  // markdown block (typically an Element → Token table).
  const { blocks: counterexamples, rest: afterCE } = extractTags(rawDoc, "counterexample");
  const { blocks: tokens, rest: doc } = extractTags(afterCE, "tokens");
  return {
    kind,
    name,
    file: path.basename(file),
    doc,
    propsSource: extractPropsType(source, name),
    subcomponents: extractSubcomponents(source),
    counterexamples,
    tokens,
  };
}

async function scanDir(dir: string, kind: "composite" | "template"): Promise<KitManifestEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // dir absent (e.g. user-kit never created) — not an error
  }
  const files = names.filter((n) => n.endsWith(".tsx")).sort().map((n) => path.join(dir, n));
  const out: KitManifestEntry[] = [];
  for (const f of files) {
    const entry = await parseFile(f, kind);
    if (entry) out.push(entry);
  }
  return out;
}

export async function buildManifestEntries(kitRoot: string): Promise<KitManifestEntry[]> {
  const compositeDir = path.join(kitRoot, "composites");
  const templateDir = path.join(kitRoot, "templates");
  const composites = await scanDir(compositeDir, "composite");
  const templates = await scanDir(templateDir, "template");
  return [...composites, ...templates];
}

/**
 * Merge shipped kit entries with the writable per-user kit. Shipped first;
 * user composites appended; on a name clash the shipped entry wins (a user
 * can't shadow a built-in). A missing/empty user root is fine.
 */
export async function buildMergedManifestEntries(
  shippedRoot: string,
  userRoot?: string,
): Promise<KitManifestEntry[]> {
  const shipped = await buildManifestEntries(shippedRoot);
  if (!userRoot) return shipped;
  const userComposites = await scanDir(path.join(userRoot, "composites"), "composite");
  const have = new Set(shipped.map((e) => e.name));
  const fresh = userComposites.filter((e) => !have.has(e.name));
  return [...shipped, ...fresh];
}

function renderEntry(entry: KitManifestEntry): string {
  const heading = `## ${entry.name} (${entry.kind})`;
  const fileLine = `_source: \`${entry.kind === "composite" ? "composites" : "templates"}/${entry.file}\`_`;
  const docBlock = entry.doc ? `\n${entry.doc}\n` : "";
  const subLine =
    entry.subcomponents.length > 0
      ? `\n**Compound:** ${entry.subcomponents.map((s) => `\`${entry.name}.${s}\``).join(", ")}`
      : "";
  const propsBlock = entry.propsSource
    ? `\n\n\`\`\`ts\n${entry.propsSource}\n\`\`\``
    : "";
  const counterBlock =
    entry.counterexamples.length > 0
      ? `\n\n**When NOT to use this:**\n${entry.counterexamples.map((c) => `- ${c}`).join("\n")}`
      : "";
  const tokensBlock =
    entry.tokens.length > 0
      ? `\n\n**Tokens commonly needed inside this composite's user slot:**\n\n${entry.tokens.join("\n\n")}`
      : "";
  return [heading, fileLine, docBlock + subLine + propsBlock + counterBlock + tokensBlock].join("\n");
}

/** First sentence of the doc, collapsed to one line — the index one-liner. */
function firstSentence(doc: string): string {
  const flat = doc.replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.*?[.!?])(\s|$)/);
  return (m ? m[1] : flat).slice(0, 200);
}

/** Top-level prop names (with `?` optionality) pulled from the props source,
 *  comma-joined. Enough for the agent to know the shape from the index; full
 *  types live in the per-entry detail. */
function propsFieldList(propsSource?: string): string {
  if (!propsSource) return "";
  const names = [...propsSource.matchAll(/^\s{2,4}([a-zA-Z_]\w*)(\??)\s*:/gm)].map(
    (m) => `${m[1]}${m[2]}`,
  );
  return [...new Set(names)].join(", ");
}

/** Render ONE entry's full detail (heading, diagram, props, counterexamples,
 *  tokens). Served by `GET /manifest/:name`. */
export function renderEntryDetail(entry: KitManifestEntry): string {
  return renderEntry(entry);
}

/** Slim catalog: every entry as name + kind + one-liner + prop names + a
 *  pointer to its detail route. Stays well under the agent runtime's tool-
 *  output cap so the whole catalog survives a single fetch; the agent then
 *  pulls full detail for only the 2-3 entries it actually uses. */
export function renderManifestIndex(entries: KitManifestEntry[]): string {
  const composites = entries.filter((e) => e.kind === "composite");
  const templates = entries.filter((e) => e.kind === "template");
  const header = [
    "# Prototype kit manifest — index",
    "",
    "> This is the catalog of EVERY arcade composite and template. It is the",
    "> closed list — if a component is not here, it does not exist.",
    ">",
    "> Each entry shows its name, a one-line summary, and its prop names. For",
    "> the FULL detail of a component you intend to use (layout diagram, full",
    "> prop types, examples, when-NOT-to-use), GET `/manifest/<Name>` — e.g.",
    "> `/manifest/ComputerPage`. Fetch detail for the 2-3 you need before",
    "> writing the frame; do NOT hand-roll a component that exists here.",
    "",
    `_${entries.length} entries — ${composites.length} composites, ${templates.length} templates._`,
    "",
  ].join("\n");
  const line = (e: KitManifestEntry): string => {
    const props = propsFieldList(e.propsSource);
    const compound =
      e.subcomponents.length > 0
        ? `\ncompound: ${e.subcomponents.map((s) => `${e.name}.${s}`).join(", ")}`
        : "";
    return [
      `### ${e.name} (${e.kind})`,
      firstSentence(e.doc),
      props ? `props: ${props}` : "",
      `detail: GET /manifest/${e.name}`,
    ]
      .filter(Boolean)
      .join("\n") + compound;
  };
  const body = [
    "## Templates\n",
    ...templates.map(line),
    "\n## Composites\n",
    ...composites.map(line),
  ].join("\n\n");
  return `${header}\n${body}\n`;
}

export function renderManifestMarkdown(entries: KitManifestEntry[]): string {
  const composites = entries.filter((e) => e.kind === "composite");
  const templates = entries.filter((e) => e.kind === "template");
  const header = [
    "# Prototype kit manifest",
    "",
    "> Auto-generated from `studio/prototype-kit/{composites,templates}/*.tsx`.",
    "> DO NOT edit by hand — run the studio dev server (or `writeManifest()`)",
    "> to refresh. Read this file BEFORE reading any individual composite or",
    "> template source; if a prop signature here is enough, skip the extra",
    "> `Read`. Open the `.tsx` only when you need the full rendered markup.",
    "",
    `_${entries.length} entries — ${composites.length} composites, ${templates.length} templates._`,
    "",
  ].join("\n");
  const body = [
    "## Templates\n",
    ...templates.map(renderEntry),
    "\n## Composites\n",
    ...composites.map(renderEntry),
  ].join("\n\n");
  return `${header}\n${body}\n`;
}

/** Build + write the manifest to `<kitRoot>/KIT-MANIFEST.md`. Returns the
 *  absolute path. Safe to call repeatedly; no-ops when content is unchanged. */
export async function writeManifest(kitRoot: string): Promise<string> {
  const entries = await buildManifestEntries(kitRoot);
  const content = renderManifestMarkdown(entries);
  const outPath = path.join(kitRoot, "KIT-MANIFEST.md");
  let existing = "";
  try {
    existing = await fs.readFile(outPath, "utf-8");
  } catch {}
  if (existing !== content) {
    await fs.writeFile(outPath, content);
  }
  return outPath;
}
