#!/usr/bin/env node
// PostToolUse hook: block Write/Edit that use design-token utility classes in
// the un-compilable "named" form (text-fg-neutral-medium) instead of the paren
// form the kit uses (text-(--fg-neutral-medium)). Tailwind v4 compiles the
// named form to NOTHING, so the frame renders with no colors (the
// implement-this-design-precisely-3 "unstyled frame" bug). Mirrors
// validateArcadeImports.mjs: pure exports for tests + main() that exits 0/2.
// Fails open on any error — a broken hook must not wedge generation.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Tailwind prefixes that take a color/token value. A class of the form
// `<prefix>-<tail>` where <tail> is a real token name but written WITHOUT the
// paren/`--` form never compiles → silent no-op.
const TOKEN_PREFIXES = [
  "text", "bg", "border", "fill", "ring", "stroke", "from", "to", "via",
  "divide", "outline", "decoration", "accent", "caret", "placeholder",
];

/** Every custom-property name (sans leading --) defined in the CSS text. */
export function extractTokenNames(cssText) {
  const out = new Set();
  if (typeof cssText !== "string" || !cssText) return out;
  const re = /--([a-z0-9-]+)\s*:/gi;
  let m;
  while ((m = re.exec(cssText)) !== null) out.add(m[1].toLowerCase());
  return out;
}

/** Class tokens from className/class string literals in the source. */
export function parseClassNames(source) {
  if (typeof source !== "string" || !source) return [];
  const out = new Set();
  // className="…"  |  className={"…"}  |  class="…"  (single or double quotes)
  const re = /class(?:Name)?=\{?\s*["'`]([^"'`]*)["'`]\s*\}?/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    for (const tok of m[1].split(/\s+/)) {
      const t = tok.trim();
      if (t) out.add(t);
    }
  }
  return [...out];
}

/**
 * Split a class into its optional variant prefix chain (hover:, md:, etc.) and
 * the base utility. Returns { variants, base } where variants includes the
 * trailing ":" chain (e.g. "hover:") or "" if none.
 */
function splitVariants(cls) {
  const idx = cls.lastIndexOf(":");
  if (idx === -1) return { variants: "", base: cls };
  return { variants: cls.slice(0, idx + 1), base: cls.slice(idx + 1) };
}

/**
 * One violation per class of the named-token form whose tail is a real token.
 * e.g. `text-fg-neutral-medium` → tail `fg-neutral-medium` ∈ tokens →
 * suggest `text-(--fg-neutral-medium)`. Also catches cases where the full base
 * is itself a token name (e.g. `bg-intelligence-prominent` where
 * `--bg-intelligence-prominent` is the token) but the tail is not. Preserves
 * any variant prefix. Fails open: empty token set → no violations.
 */
export function detectTokenClassViolations(classes, tokenNames) {
  if (!tokenNames || tokenNames.size === 0) return [];
  const out = [];
  for (const cls of classes) {
    // Skip the correct paren form and arbitrary brackets outright.
    if (cls.includes("(--") || cls.includes("[")) continue;
    const { variants, base } = splitVariants(cls);
    const dash = base.indexOf("-");
    if (dash === -1) continue;
    const prefix = base.slice(0, dash);
    const tail = base.slice(dash + 1);
    if (!TOKEN_PREFIXES.includes(prefix)) continue;

    const tailIsToken = tokenNames.has(tail.toLowerCase());
    const baseIsToken = tokenNames.has(base.toLowerCase());

    // Flag if the tail is a token (e.g., text-fg-neutral-medium → tail=fg-neutral-medium)
    if (tailIsToken) {
      out.push({
        badClass: cls,
        suggestion: `${variants}${prefix}-(--${tail})`,
      });
      continue;
    }

    // Also flag if the FULL base is itself a token name BUT the tail is not
    // (e.g., bg-intelligence-prominent where --bg-intelligence-prominent is the token).
    // This ensures we don't flag built-in utilities like bg-gradient-to-r when a token
    // happens to have that name.
    if (baseIsToken && !tailIsToken) {
      out.push({
        badClass: cls,
        suggestion: `${variants}${prefix}-(--${base})`,
      });
    }
  }
  return out;
}

/**
 * Resolve the shipped arcade-gen token CSS and return its token-name set.
 * The runtime aliases `arcade/components` to a barrel that re-exports
 * @xorkavi/arcade-gen; the compiled tokens live in that package's
 * dist/styles.css — present on every machine incl. the packaged DMG.
 * Fails open (empty set) if unresolvable — mirrors validateArcadeImports'
 * empty-barrel guard.
 */
export function loadTokenNames() {
  try {
    const require = createRequire(import.meta.url);
    const mainEntry = require.resolve("@xorkavi/arcade-gen"); // → dist/index.mjs
    const cssPath = path.join(path.dirname(mainEntry), "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    return extractTokenNames(css);
  } catch {
    return new Set(); // fail open
  }
}

export function formatTokenClassError(violations) {
  if (!violations.length) return "";
  const lines = [];
  lines.push("Blocked: these design-token classes compile to NOTHING in Tailwind v4");
  lines.push("(they render no color/background). Use the CSS-variable paren form:");
  lines.push("");
  for (const v of violations) {
    lines.push(`  - \`${v.badClass}\` → \`${v.suggestion}\``);
  }
  lines.push("");
  lines.push("Colors/surfaces/strokes use the paren form: text-(--fg-neutral-prominent),");
  lines.push("bg-(--surface-shallow), border-(--stroke-neutral-subtle). Typography stays a");
  lines.push("named utility (text-body, text-body-small). This hook runs on every Write/Edit");
  lines.push("and will block again until the classes are fixed.");
  return lines.join("\n");
}

function isInScope(filePath) {
  if (typeof filePath !== "string") return false;
  return filePath.endsWith(".tsx") || filePath.endsWith(".ts");
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
  if (!isInScope(toolInput?.file_path)) process.exit(0);
  const content = extractContent(toolName, toolInput);
  if (!content) process.exit(0);

  const tokenNames = loadTokenNames();
  const classes = parseClassNames(content);
  const violations = detectTokenClassViolations(classes, tokenNames);
  if (violations.length === 0) process.exit(0);

  process.stderr.write(formatTokenClassError(violations));
  process.exit(2);
}

// Run main() only when invoked directly (not when imported by tests). Compare
// resolved file URLs — a space in the packaged path (".../Arcade Studio.app/…")
// is percent-encoded in import.meta.url, so a raw template literal never
// matches. pathToFileURL encodes argv[1] the same way. (Same guard as
// validateArcadeImports.mjs.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => process.exit(0));
}
