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
  "divide", "outline", "decoration", "shadow", "accent", "caret", "placeholder",
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
 * suggest `text-(--fg-neutral-medium)`. Preserves any variant prefix.
 * Fails open: empty token set → no violations.
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
    if (!tokenNames.has(tail.toLowerCase())) continue; // tail isn't a real token → not ours
    out.push({
      badClass: cls,
      suggestion: `${variants}${prefix}-(--${tail})`,
    });
  }
  return out;
}
