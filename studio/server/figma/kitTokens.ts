/**
 * Figma variable → arcade-gen design-token resolution for the kit-emit engine.
 *
 * The emitter (kitEmit.ts) bakes literal hex for every fill/stroke/text color.
 * When a Figma node's color is BOUND to a variable, we'd rather emit the kit's
 * CSS custom property (`var(--bg-neutral-soft)`) so the frame follows the
 * design system (light/dark theme via DevRevThemeProvider) and lifts cleanly to
 * production — instead of a hardcoded off-palette hex.
 *
 * Two safety rules make this fidelity-preserving (a bound color must render the
 * SAME visual color via its token, never a wrong one):
 *
 *  1. VALIDATE against the kit's real token set. The transform
 *     `bg/neutral/soft → --bg-neutral-soft` is a guess until checked against the
 *     tokens the kit actually defines. We parse the token names from the
 *     resolved `@xorkavi/arcade-gen/dist/tokens.css` once (cached) and only emit
 *     `var(--x)` when `--x` is in that set. A Figma var named `surface/default`
 *     that has no `--surface-default` in the kit (the kit only has
 *     `--surface-shallow`/`-overlay`/`-backdrop`) falls back to hex, never to a
 *     dead var that paints nothing.
 *
 *  2. DISAMBIGUATE by CSS property context. A value used for text `color` must
 *     map into the `--fg-*` namespace; a `background`/fill into `--bg-*`; a
 *     stroke into `--stroke-*`. The Figma var path usually already carries the
 *     right prefix (`fg/…`, `bg/…`, `stroke/…`), so honoring it mostly solves
 *     this — but if the resolved token's namespace contradicts the property
 *     (the documented bubble bug: a `--bg-*` token bound to a text color), we
 *     fall back to hex rather than emit a theme-wrong token.
 *
 * Hex stays the default. Token lookup is an OPT-IN overlay: only when a paint is
 * bound to a variable AND the transform validates AND the namespace matches does
 * hex → var(). Every miss emits hex and is counted so coverage can grow.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

/** CSS property a color is being emitted for — drives namespace disambiguation. */
export type ColorProperty = "background" | "stroke" | "color";

/**
 * Token namespaces (the `--x-` prefix segment) that are valid for each CSS
 * property. A background must resolve to a `--bg-*` or `--surface-*` token; a
 * stroke to `--stroke-*`; text `color` to `--fg-*`. A token whose namespace is
 * outside this list for the property is a contradiction → fall back to hex.
 */
const NAMESPACE_FOR_PROPERTY: Record<ColorProperty, string[]> = {
  background: ["bg", "surface"],
  stroke: ["stroke"],
  color: ["fg"],
};

/**
 * Transform a Figma variable name (slash-delimited path, e.g. `bg/neutral/soft`
 * or `fg/neutral-strong`) into the kit's hyphen-flattened CSS custom-property
 * name (`--bg-neutral-soft`). Lowercase, whitespace → `-`, `/` → `-`, prefix
 * `--`, and collapse any run of `-` so `fg / neutral` and `fg/neutral` agree.
 */
export function figmaVarNameToKitToken(figmaName: string): string {
  const flat = figmaName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\//g, "-")
    .replace(/-+/g, "-");
  return `--${flat}`;
}

/** The `--x-` namespace segment of a kit token name, e.g. `--bg-neutral-soft` → `bg`. */
function tokenNamespace(token: string): string {
  return token.replace(/^--/, "").split("-")[0];
}

// --- kit token set (validation source of truth) ---------------------------

let cachedTokenNames: Set<string> | null = null;

/**
 * Resolve `@xorkavi/arcade-gen/dist/tokens.css` from the resolvable package
 * (NOT a hardcoded copy) so a kit version bump can't desync the allow-list —
 * mirrors the import-validation hook's resolve-the-main-entry approach. The
 * package's `exports` map doesn't expose `./package.json`, so resolve the main
 * entry and take its directory.
 */
function resolveTokensCssPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const mainEntry = require.resolve("@xorkavi/arcade-gen");
    return path.join(path.dirname(mainEntry), "tokens.css");
  } catch {
    return null;
  }
}

/** Parse every `--name:` custom-property declaration out of tokens.css. */
function parseTokenNames(css: string): Set<string> {
  const set = new Set<string>();
  const re = /(^|[;{}\s])(--[a-z0-9-]+)\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) set.add(m[2].toLowerCase());
  return set;
}

/**
 * The set of CSS custom-property names the kit defines, parsed once from
 * tokens.css and cached for the process. Returns an empty set (token resolution
 * then always misses → hex everywhere, today's behavior) if the package can't
 * be resolved — never throws, so a missing kit can't break a turn.
 *
 * Exposed `inject`/`reset` purely for tests: parsing the real ~700-token file on
 * every assertion is slow and couples tests to the installed kit version.
 */
export function kitTokenNames(): Set<string> {
  if (cachedTokenNames) return cachedTokenNames;
  const p = resolveTokensCssPath();
  if (!p) {
    cachedTokenNames = new Set();
    return cachedTokenNames;
  }
  try {
    cachedTokenNames = parseTokenNames(readFileSync(p, "utf-8"));
  } catch {
    cachedTokenNames = new Set();
  }
  return cachedTokenNames;
}

/** Test seam: inject a known token set so assertions don't depend on the kit. */
export function __setKitTokenNamesForTest(names: Iterable<string>): void {
  cachedTokenNames = new Set([...names].map((n) => n.toLowerCase()));
}

/** Test seam: clear the cache so the next call re-reads tokens.css. */
export function __resetKitTokenNamesForTest(): void {
  cachedTokenNames = null;
}

/**
 * Resolve a bound Figma variable name to a kit `var(--x)` expression for the
 * given CSS property, or null when it can't be resolved safely (the caller then
 * keeps its literal hex). Returns null when:
 *  - the transformed name is not a token the kit defines (validation), or
 *  - the token's namespace contradicts the property (disambiguation).
 *
 * `tokenSet` defaults to the parsed kit set; tests pass an explicit set.
 */
export function resolveKitTokenVar(
  figmaName: string | undefined,
  property: ColorProperty,
  tokenSet: Set<string> = kitTokenNames(),
): string | null {
  if (!figmaName) return null;
  const token = figmaVarNameToKitToken(figmaName);
  if (!tokenSet.has(token)) return null; // unknown to the kit → hex, never a dead var
  const ns = tokenNamespace(token);
  if (!NAMESPACE_FOR_PROPERTY[property].includes(ns)) return null; // wrong namespace → hex
  return `var(${token})`;
}
