#!/usr/bin/env node
// PostToolUse hook: validate named imports from "arcade/components" and
// "arcade-prototypes" against the real barrels. Blocks Write/Edit tool
// calls that introduce hallucinated names (e.g. ArrowsUpDownSmall), with
// Did-you-mean suggestions so the agent can self-correct in the same turn.
//
// Mirrors the shape of blockImageReshape.mjs: pure-function exports for
// tests, plus a main() that reads stdin and exits 0 or 2. Fails open on
// any parse/runtime error — a broken hook must not wedge a real generation.

import { readFileSync } from "node:fs";

const TRACKED_SOURCES = ["arcade/components", "arcade-prototypes"];

/**
 * Parse named imports from the file's source text. Returns one entry per
 * tracked source, deduplicated. Ignores imports from untracked sources
 * (react, relatives, node:, third-party) entirely.
 *
 * For `import { Foo as Bar } from <source>`, records Foo (the source name
 * that must exist in the barrel), not Bar (the local alias).
 */
export function parseImports(source) {
  if (typeof source !== "string") return [];
  const re = /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  const bySource = new Map();
  let m;
  while ((m = re.exec(source)) !== null) {
    const braceGroup = m[1];
    const src = m[2];
    if (!TRACKED_SOURCES.includes(src)) continue;
    const names = parseBraceGroup(braceGroup);
    if (!names.length) continue;
    if (!bySource.has(src)) bySource.set(src, new Set());
    const set = bySource.get(src);
    for (const name of names) set.add(name);
  }
  return [...bySource.entries()].map(([source, set]) => ({
    source,
    names: [...set],
  }));
}

function parseBraceGroup(group) {
  const tokens = group.split(",").map((t) => t.trim()).filter(Boolean);
  const out = [];
  for (const token of tokens) {
    // Strip `type` prefix (`type Foo` or `type Foo as Bar`).
    let t = token;
    if (/^type\s+/.test(t)) continue;
    // `Foo as Bar` — keep Foo (source-side name).
    const asIdx = t.search(/\s+as\s+/);
    if (asIdx !== -1) t = t.slice(0, asIdx).trim();
    if (/^[A-Za-z_][\w$]*$/.test(t)) out.push(t);
  }
  return out;
}

/**
 * Load publicly-importable value-export names from a barrel file.
 * Skips `export type { ... }` and `export { type X }` — those are not
 * importable as values. For `export { Foo as Bar }`, records Bar (what
 * consumers can `import { Bar } from "..."`).
 *
 * Returns an empty Set on any I/O or parse error. The caller interprets
 * that as "fail open for this source" — we validate what we can.
 */
export function loadBarrel(absPath) {
  let text;
  try { text = readFileSync(absPath, "utf-8"); }
  catch { return new Set(); }
  return extractBarrelExports(text);
}

export function extractBarrelExports(text) {
  const out = new Set();
  // Match `export { ... } from "..."` statements, case-sensitive.
  // The brace group may span multiple lines.
  const re = /export\s+(type\s+)?\{([^}]+)\}\s+from\s+["'][^"']+["']/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const isTypeOnlyBlock = Boolean(m[1]);
    if (isTypeOnlyBlock) continue;
    const braceGroup = m[2];
    for (const name of parseBarrelBraceGroup(braceGroup)) out.add(name);
  }
  return out;
}

function parseBarrelBraceGroup(group) {
  const tokens = group.split(",").map((t) => t.trim()).filter(Boolean);
  const out = [];
  for (const token of tokens) {
    // Skip per-token `type` — `export { type Foo }` is not a value.
    if (/^type\s+/.test(token)) continue;
    // `Foo as Bar` — the publicly importable name is Bar.
    const asMatch = token.match(/^([A-Za-z_][\w$]*)\s+as\s+([A-Za-z_][\w$]*)$/);
    if (asMatch) { out.push(asMatch[2]); continue; }
    if (/^[A-Za-z_][\w$]*$/.test(token)) out.push(token);
  }
  return out;
}

export const MAX_SUGGESTION_DISTANCE = 4;
export const MAX_SUGGESTIONS = 3;

/**
 * Given a set of extracted imports and the loaded barrels, produce one
 * violation per (source, badName) pair with up to MAX_SUGGESTIONS
 * suggestions sorted by ascending Levenshtein distance, keeping only
 * those with distance <= MAX_SUGGESTION_DISTANCE.
 *
 * Fails open: if a source's barrel is empty (load failed), we skip
 * validation for that source rather than flagging everything as bad.
 */
export function validateImports(imports, barrels) {
  const violations = [];
  for (const { source, names } of imports) {
    const barrel = barrels[source];
    if (!barrel || barrel.size === 0) continue; // fail open for this source
    for (const name of names) {
      if (barrel.has(name)) continue;
      violations.push({
        source,
        badName: name,
        suggestions: topSuggestions(name, barrel),
      });
    }
  }
  return violations;
}

function topSuggestions(badName, barrel) {
  const scored = [];
  for (const candidate of barrel) {
    const d = levenshtein(badName, candidate);
    if (d <= MAX_SUGGESTION_DISTANCE) scored.push({ candidate, d });
  }
  scored.sort((a, b) => a.d - b.d || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, MAX_SUGGESTIONS).map((s) => s.candidate);
}

// Plain iterative Levenshtein — O(n*m) with two rolling rows. Inputs are
// short identifiers; no optimization needed.
export function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/**
 * Build the human-readable stderr message the hook emits on block.
 * Groups violations by source; for each bad name, emits the top-3
 * suggestions inline or the absolute barrel path if no suggestion met
 * the distance threshold. Export counts are included so the model's
 * size intuition is correct.
 */
export function formatErrorMessage(violations, barrels, barrelPaths) {
  const bySource = new Map();
  for (const v of violations) {
    if (!bySource.has(v.source)) bySource.set(v.source, []);
    bySource.get(v.source).push(v);
  }
  const lines = ["Blocked: some imports don't exist in their declared source.", ""];
  for (const [source, group] of bySource) {
    lines.push(`In "${source}":`);
    for (const v of group) {
      if (v.suggestions.length > 0) {
        lines.push(`  - \`${v.badName}\` — did you mean ${v.suggestions.map((s) => `\`${s}\``).join(", ")}?`);
      } else {
        const size = barrels[source]?.size ?? 0;
        const p = barrelPaths[source] ?? "<unknown>";
        lines.push(`  - \`${v.badName}\` — no near-matches.`);
        lines.push(`      Read ${p} for the full list of ${size} exports.`);
      }
    }
    lines.push("");
  }
  lines.push("Fix the names (or drop the symbol) and re-Write. This hook runs on");
  lines.push("every Write/Edit and will block again if the imports still don't exist.");
  return lines.join("\n");
}

import path from "node:path";

const HOME = process.env.HOME ?? "";
const ARCADE_GEN_ROOT = process.env.ARCADE_GEN_ROOT
  ?? (HOME ? path.join(HOME, "arcade-gen") : "/__arcade_gen_unconfigured");
const ARCADE_PROTOTYPER_ROOT = process.env.ARCADE_PROTOTYPER_ROOT ?? "";

function barrelPathsForEnv() {
  return {
    "arcade/components": [
      path.join(ARCADE_GEN_ROOT, "src/components/index.ts"),
      path.join(ARCADE_GEN_ROOT, "src/components/icons/index.ts"),
    ],
    "arcade-prototypes": [
      ARCADE_PROTOTYPER_ROOT
        ? path.join(ARCADE_PROTOTYPER_ROOT, "prototype-kit/index.ts")
        : path.resolve(new URL("../../prototype-kit/index.ts", import.meta.url).pathname),
    ],
  };
}

function loadAllBarrels() {
  const paths = barrelPathsForEnv();
  const barrels = {};
  const resolvedPaths = {};
  for (const [source, files] of Object.entries(paths)) {
    const merged = new Set();
    for (const f of files) {
      for (const name of loadBarrel(f)) merged.add(name);
    }
    barrels[source] = merged;
    // Show the first file as the "canonical" path in error messages — the
    // one the model is most likely to Read.
    resolvedPaths[source] = files[0];
  }
  return { barrels, barrelPaths: resolvedPaths };
}

function isInScope(filePath) {
  if (typeof filePath !== "string") return false;
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return false;
  const base = path.basename(filePath);
  if (base === "index.errors.json" || base === "project.json") return false;
  return true;
}

/**
 * Strip line comments and block comments. Strings and template literals
 * are left intact — downstream callers that need strings removed should
 * use `stripCommentsAndStrings` on top.
 */
export function stripComments(source) {
  if (typeof source !== "string") return "";
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      // Copy the string verbatim so downstream regexes can still match
      // `from "module-path"` in import statements.
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (source[i] === "\\") { out += source[i] + (source[i + 1] ?? ""); i += 2; continue; }
        out += source[i];
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Strip line comments, block comments, and string/template literals. The
 * goal is to stop `// <Foo>` and `"<Foo>"` from being read as JSX.
 */
export function stripCommentsAndStrings(source) {
  if (typeof source !== "string") return "";
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) { out += quote; i++; break; }
        // Inside template literals, allow ${...} to keep expressions visible.
        if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
          out += "${";
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            if (depth === 0) break;
            out += source[i];
            i++;
          }
          out += "}";
          i++;
          continue;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Extract capitalized JSX opening-element names from source text. For
 * member expressions like `<Foo.Bar />`, records the root name `Foo` —
 * that's the binding that must be defined in scope.
 *
 * The heuristic distinguishes JSX from TS generics:
 *   - A JSX opener's `<` is preceded by whitespace, `(`, `{`, `,`, `>`,
 *     `;`, `=`, `?`, `:`, `&`, `|`, or start-of-file — never by an
 *     identifier or `.`. `useState<Foo>()` is excluded because `<` is
 *     preceded by `useState`.
 *   - The character after the name is `\s`, `/`, `>`, or `.` (member
 *     access). `<Foo, Bar>` (generic list) is excluded.
 *
 * Call only on .tsx content. In .ts files, `<Foo>y` is a type cast and
 * would produce false positives.
 */
export function extractJsxComponentNames(source) {
  const stripped = stripCommentsAndStrings(source);
  const re = /(^|[^A-Za-z0-9_$.])<([A-Z][A-Za-z0-9_$]*)(?=\.|[\s/>])/g;
  const out = new Set();
  let m;
  while ((m = re.exec(stripped)) !== null) out.add(m[2]);
  return [...out];
}

/**
 * Collect every identifier that's defined as a *value* in this file. Used
 * to decide whether a JSX component name resolves to anything. Includes:
 *   - named/default/namespace imports (from any source, not just tracked)
 *   - top-level `function`, `class`, `const`, `let`, `var` declarations
 *
 * Deliberately conservative: destructured names, nested functions, and
 * re-exports are ignored. Missing a real definition only produces a
 * false-positive block, which the agent can resolve by moving the
 * declaration to module scope — same shape as the Did-you-mean block.
 */
export function collectDefinedIdentifiers(source) {
  // Strip comments but keep string contents — import sources live in strings,
  // and the regexes below look for `from "..."` to anchor import matches.
  const stripped = stripComments(source);
  const defined = new Set();

  // import { Foo, Bar as Baz } from "..."
  const namedImport = /import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s+from\s+["'][^"']+["']/g;
  let m;
  while ((m = namedImport.exec(stripped)) !== null) {
    for (const tok of m[1].split(",")) {
      const t = tok.trim();
      if (!t || /^type\s+/.test(t)) continue;
      const asMatch = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) defined.add(asMatch[2]);
      else if (/^[A-Za-z_$][\w$]*$/.test(t)) defined.add(t);
    }
  }

  // import Foo from "..."   and   import Foo, { ... } from "..."
  const defaultImport = /import\s+([A-Za-z_$][\w$]*)(?:\s*,\s*\{[^}]*\})?\s+from\s+["'][^"']+["']/g;
  while ((m = defaultImport.exec(stripped)) !== null) defined.add(m[1]);

  // import * as Foo from "..."
  const namespaceImport = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/g;
  while ((m = namespaceImport.exec(stripped)) !== null) defined.add(m[1]);

  // function Foo(...) / export function Foo(...) / async function Foo(...)
  const fnDecl = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  while ((m = fnDecl.exec(stripped)) !== null) defined.add(m[1]);

  // class Foo / export class Foo
  const classDecl = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  while ((m = classDecl.exec(stripped)) !== null) defined.add(m[1]);

  // const Foo = / let Foo = / var Foo =    (single-binding top-level-ish form)
  const varDecl = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g;
  while ((m = varDecl.exec(stripped)) !== null) defined.add(m[1]);

  return defined;
}

/**
 * Given the full source of a .tsx file and the merged barrel of known
 * valid component names (arcade/components ∪ arcade-prototypes), return
 * one violation per undefined JSX component reference, with Did-you-mean
 * suggestions sourced from the merged barrel.
 *
 * Fails open when the merged barrel is empty — mirrors `validateImports`
 * so a misconfigured env doesn't block every write.
 */
export function validateJsxReferences(source, mergedBarrel) {
  if (!mergedBarrel || mergedBarrel.size === 0) return [];
  const defined = collectDefinedIdentifiers(source);
  const names = extractJsxComponentNames(source);
  const violations = [];
  for (const name of names) {
    if (defined.has(name)) continue;
    violations.push({
      name,
      suggestions: topSuggestions(name, mergedBarrel),
    });
  }
  return violations;
}

/**
 * Format JSX-reference violations as a stderr block. Shape mirrors
 * `formatErrorMessage` so the agent sees a consistent "Blocked: …" shell
 * regardless of which check failed.
 */
export function formatJsxErrorMessage(violations, barrelPaths) {
  if (violations.length === 0) return "";
  const lines = [];
  lines.push("JSX references that aren't imported or declared:");
  for (const v of violations) {
    if (v.suggestions.length > 0) {
      lines.push(`  - \`<${v.name}>\` — did you mean ${v.suggestions.map((s) => `\`${s}\``).join(", ")}? (and add the import)`);
    } else {
      const paths = Object.values(barrelPaths ?? {}).filter(Boolean);
      lines.push(`  - \`<${v.name}>\` — no near-matches in the kit.`);
      if (paths.length) {
        lines.push(`      Read one of:`);
        for (const p of paths) lines.push(`        ${p}`);
      }
    }
  }
  lines.push("");
  lines.push("Every capitalized JSX tag must resolve to an import or a local");
  lines.push("declaration in the same file. Inventing composite names is the");
  lines.push("top cause of runtime-only frame crashes.");
  return lines.join("\n");
}

function extractContent(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  if (toolName === "Write") return typeof toolInput.content === "string" ? toolInput.content : "";
  if (toolName === "Edit") return typeof toolInput.new_string === "string" ? toolInput.new_string : "";
  return "";
}

async function readStdin() {
  let buf = "";
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

async function main() {
  let payload;
  try {
    const raw = await readStdin();
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    process.exit(0);
  }
  const toolName = payload?.tool_name;
  const toolInput = payload?.tool_input;
  if (toolName !== "Write" && toolName !== "Edit") process.exit(0);
  const filePath = toolInput?.file_path;
  if (!isInScope(filePath)) process.exit(0);
  const content = extractContent(toolName, toolInput);
  if (!content) process.exit(0);

  const { barrels, barrelPaths } = loadAllBarrels();

  const imports = parseImports(content);
  const importViolations = imports.length ? validateImports(imports, barrels) : [];

  // JSX-reference check only for .tsx — .ts files use `<Foo>x` as type casts.
  let jsxViolations = [];
  if (filePath.endsWith(".tsx")) {
    const merged = new Set();
    for (const s of Object.values(barrels)) for (const n of s) merged.add(n);
    jsxViolations = validateJsxReferences(content, merged);
  }

  if (importViolations.length === 0 && jsxViolations.length === 0) process.exit(0);

  const chunks = [];
  if (importViolations.length) {
    chunks.push(formatErrorMessage(importViolations, barrels, barrelPaths));
  }
  if (jsxViolations.length) {
    if (chunks.length === 0) {
      chunks.push("Blocked: some JSX tags don't resolve to an import or a local declaration.\n");
    }
    chunks.push(formatJsxErrorMessage(jsxViolations, barrelPaths));
  }
  process.stderr.write(chunks.join("\n"));
  process.exit(2);
}

// Allow importing for tests without running main().
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => process.exit(0));
}
