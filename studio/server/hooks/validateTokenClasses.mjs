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
import { ADS_COLOR_SEED } from "../figma/adsColorSeed.mjs";

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
 * Custom-property REFERENCES: Tailwind `bg-(--x)`, CSS `var(--x)`, `[var(--x)]`
 * (all contain the `(--x)` substring). Requires ≥1 internal hyphen so a JS
 * decrement `(--i)` is never captured (every DS token is multi-segment).
 */
export function extractTokenRefs(source) {
  const out = new Set();
  if (typeof source !== "string" || !source) return out;
  const re = /\(\s*--([a-z0-9]+(?:-[a-z0-9]+)+)\s*\)/gi;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1].toLowerCase());
  return out;
}

/**
 * Custom-property DEFINITIONS in the source, so an author's own inline var is
 * never flagged as dead. Matches THREE forms:
 *   --x:                       (CSS / style string)      →  --x\s*:
 *   { "--x": v } / { '--x': v }(React quoted object key) →  ["']--x["']\s*:
 *   { ["--x"]: v }             (React computed key)       →  \[\s*["']--x["']\s*\]\s*:
 * The base regex `/--([a-z0-9-]+)\s*:/` (used by extractTokenNames) misses the
 * quoted/bracketed forms because a "/] sits between name and colon.
 */
export function extractLocalDefs(source) {
  const out = new Set();
  if (typeof source !== "string" || !source) return out;
  // Plain --x: and quoted "--x": / '--x': and computed ["--x"]: — the optional
  // quote/bracket chars between the name and the colon are what the base regex lacks.
  const re = /(?:\[\s*)?["']?--([a-z0-9-]+)["']?\s*\]?\s*:/gi;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1].toLowerCase());
  return out;
}

/** Longest-shared-leading-segment names from the resolvable set (a hint, not a
 *  color matcher). Must share ≥1 leading segment. */
export function suggestRealTokens(deadName, resolvable, limit = 3) {
  const segs = String(deadName).split("-");
  const scored = [];
  for (const name of resolvable) {
    const other = name.split("-");
    let shared = 0;
    while (shared < segs.length && shared < other.length && segs[shared] === other[shared]) shared++;
    if (shared === 0) continue;
    scored.push({ name, shared });
  }
  scored.sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.name);
}

/**
 * References to a `--custom-property` absent from the resolvable UNION. Each
 * violation carries realValue = the ADS seed value when the token is a REAL
 * design-system token the kit just doesn't ship (→ tell the agent the value),
 * else null (→ typo/hallucination, suggest nearest real). Fails open on an
 * empty union.
 */
export function detectDeadTokenRefs(source, resolvable, seed = ADS_COLOR_SEED) {
  if (!resolvable || resolvable.size === 0) return [];
  const out = [];
  for (const ref of extractTokenRefs(source)) {
    if (resolvable.has(ref)) continue;
    const realValue = (seed && Object.prototype.hasOwnProperty.call(seed, ref)) ? seed[ref] : null;
    out.push({ ref, realValue, suggestions: realValue ? [] : suggestRealTokens(ref, resolvable) });
  }
  return out;
}

export function formatDeadTokenError(violations) {
  if (!violations.length) return "";
  const lines = ["Blocked: these CSS-variable references resolve to NO design-system token",
    "(the class compiles but paints nothing — a silent no-op). Fix each:", ""];
  for (const v of violations) {
    if (v.realValue) {
      lines.push(`  - \`--${v.ref}\` is a REAL design-system token but the kit doesn't ship it as CSS.`);
      lines.push(`    Define it in the project's theme-overrides.css (theme-reactive), e.g.`);
      lines.push(`      :root { --${v.ref}: ${v.realValue}; }`);
      lines.push(`    or use the literal value: the \`(--${v.ref})\` → \`[${v.realValue}]\`.`);
    } else {
      const hint = v.suggestions.length
        ? ` Nearest real tokens: ${v.suggestions.map((s) => `--${s}`).join(", ")}.`
        : ` (No near match — use a real design-system token that matches the intent.)`;
      lines.push(`  - \`--${v.ref}\` is not a design-system token.${hint}`);
    }
  }
  lines.push("", "This hook runs on every Write/Edit and will block again until the references resolve.");
  return lines.join("\n");
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

/** The dead-token-ref check runs ONLY on generated frame files
 *  (…/projects/<slug>/frames/<id>/*.tsx|ts). Studio's own src/** .tsx would
 *  false-flag. The existing named-form check keeps its broader .tsx scope. */
function isFrameFile(filePath) {
  if (typeof filePath !== "string") return false;
  const s = path.sep;
  return filePath.includes(`${s}projects${s}`) && filePath.includes(`${s}frames${s}`) &&
    (filePath.endsWith(".tsx") || filePath.endsWith(".ts"));
}

/** A project's theme-overrides.css tokens genuinely resolve at render — union
 *  them in. Best-effort; "" on any miss. */
function readProjectThemeOverrides(frameFilePath) {
  try {
    const marker = `${path.sep}frames${path.sep}`;
    const idx = frameFilePath.indexOf(marker);
    if (idx === -1) return "";
    return readFileSync(path.join(frameFilePath.slice(0, idx), "theme-overrides.css"), "utf-8");
  } catch { return ""; }
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
  const classViolations = detectTokenClassViolations(classes, tokenNames);

  let deadRefs = [];
  if (isFrameFile(toolInput?.file_path)) {
    // RESOLVABLE = what actually RENDERS: kit CSS (load-bearing — carries
    // *-on-prominent) ∪ project overrides ∪ same-file local defs. The ADS seed
    // is NOT in here — it's the classification oracle passed separately. A seed
    // token the kit doesn't ship does NOT render, so it must NOT be resolvable
    // (else it silently passes = the exact bug). Fail open: empty → skip.
    const resolvable = new Set(tokenNames);                        // kit CSS (renders)
    for (const t of extractTokenNames(readProjectThemeOverrides(toolInput.file_path))) resolvable.add(t);
    for (const t of extractLocalDefs(content)) resolvable.add(t);   // author-local vars
    if (resolvable.size > 0) deadRefs = detectDeadTokenRefs(content, resolvable, ADS_COLOR_SEED);
  }

  if (classViolations.length === 0 && deadRefs.length === 0) process.exit(0);

  const message = [
    classViolations.length ? formatTokenClassError(classViolations) : "",
    deadRefs.length ? formatDeadTokenError(deadRefs) : "",
  ].filter(Boolean).join("\n\n");
  process.stderr.write(message);
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
