// studio/src/lift/drift.ts
//
// Drift audit: checks the lift-manifest mapping data against a real
// devrev-web checkout. Four categories of checks:
//
//   1. Every mapping's production specifier resolves to a real file via
//      tsconfig.base.json#compilerOptions.paths, and the expected named
//      export appears in that file.
//   2. Every prior-art path in priorArt[] exists on disk.
//   3. Every icon anchor in ICON_ANCHORS points at an ICON_TYPES enum
//      member that still exists in libs/shared/ui-icons.
//
// (A fourth category — "every arcade-gen export has a mapping OR convention
// coverage" — is handled by mappingCoverage.test.ts against studio's own
// prototype-kit; it doesn't need devrev-web and runs in the regular suite.)
//
// Operational model: this does NOT run in the default test suite. arcade-
// prototyper doesn't depend on devrev-web being cloned locally, so the
// audit is opt-in via the scripts/drift-audit entry point. CI wiring (e.g.
// a scheduled job filing an issue on drift) is out of scope for this PR —
// the script + exit code are the contract.

import fs from "node:fs";
import path from "node:path";

import { ALL_MAPPINGS } from "./mappings";
import { ICON_ANCHORS } from "./icons";
import { TOKEN_PATCHES, CLASS_PATCHES, type Patch } from "./tokens";

export interface DriftFinding {
  category:
    | "specifier"
    | "export"
    | "prior-art"
    | "icon-anchor"
    | "stale-patch"
    | "token-resolution"
    | "figma-value-drift";
  /** Studio-side identifier this finding pertains to (mapping name, anchor name). */
  subject: string;
  /** Details the reader needs to act on the finding. */
  detail: string;
}

export interface DriftResult {
  findings: DriftFinding[];
  /** Summary counts, useful for the CLI output. */
  counts: {
    mappingsChecked: number;
    priorArtChecked: number;
    iconAnchorsChecked: number;
    patchesChecked: number;
    tokensChecked: number;
  };
}

/**
 * Tokens we routinely reference from Studio-lifted code. When a new
 * common token shows up in practice, add it here. The drift audit
 * reports any token in this list whose resolved value in the target
 * theme is a raw HSL triple (like `0 0% 98%`) rather than a full
 * color (like `hsl(0, 0%, 98%)` or `#fafafa`) — that's the exact
 * fallthrough bug that made card borders render black in the 2026-05-12
 * render loop. Added 2026-05-13.
 */
export const AUDITED_TOKENS: readonly string[] = [
  // Surfaces / backgrounds
  "--bg-surface-overlay",
  "--bg-surface-shallow",
  "--bg-surface-backdrop",
  "--bg-neutral-soft",
  "--bg-neutral-subtle",
  // Text
  "--fg-neutral-prominent",
  "--fg-neutral-medium",
  "--fg-neutral-subtle",
  // Strokes / borders
  "--stroke-neutral-subtle",
  "--stroke-neutral-medium",
  "--border-outline-00",
];

/**
 * Entry point. Takes the absolute path to a devrev-web checkout and
 * returns all drift findings. Does NOT throw — callers decide how to
 * surface failures.
 */
export function runDriftAudit(devrevWebRoot: string): DriftResult {
  const findings: DriftFinding[] = [];
  const paths = loadTsconfigPaths(devrevWebRoot);

  // Category 1 + 2: specifiers and priorArt.
  let mappingsChecked = 0;
  let priorArtChecked = 0;
  for (const entry of ALL_MAPPINGS) {
    if (entry.production.source !== "n/a") {
      mappingsChecked++;
      const resolved = paths.get(entry.production.source);
      if (!resolved) {
        findings.push({
          category: "specifier",
          subject: `${entry.studio.source}/${entry.studio.name}`,
          detail: `production.source '${entry.production.source}' is not in tsconfig.base.json#paths`,
        });
      } else {
        const abs = path.join(devrevWebRoot, resolved);
        if (!fs.existsSync(abs)) {
          findings.push({
            category: "specifier",
            subject: `${entry.studio.source}/${entry.studio.name}`,
            detail: `tsconfig paths '${entry.production.source}' → '${resolved}' does not exist on disk`,
          });
        } else if (!hasNamedExport(abs, entry.production.name)) {
          findings.push({
            category: "export",
            subject: `${entry.studio.source}/${entry.studio.name}`,
            detail: `export '${entry.production.name}' not found in ${resolved} (or its re-exports)`,
          });
        }
      }
    }
    for (const ex of entry.priorArt ?? []) {
      priorArtChecked++;
      const abs = path.join(devrevWebRoot, ex.path);
      if (!fs.existsSync(abs)) {
        findings.push({
          category: "prior-art",
          subject: `${entry.studio.source}/${entry.studio.name}`,
          detail: `priorArt path '${ex.path}' does not exist`,
        });
      }
    }
  }

  // Category 3: icon anchors.
  const iconTypesPath = path.join(
    devrevWebRoot,
    "libs/shared/ui-icons/src/icon/types.ts",
  );
  const iconTypesText = fs.existsSync(iconTypesPath)
    ? fs.readFileSync(iconTypesPath, "utf-8")
    : null;
  if (!iconTypesText) {
    findings.push({
      category: "icon-anchor",
      subject: "(all)",
      detail: `ICON_TYPES source file not found at ${iconTypesPath}`,
    });
  }
  for (const anchor of ICON_ANCHORS) {
    if (iconTypesText && !iconTypesHas(iconTypesText, anchor.productionIconType)) {
      findings.push({
        category: "icon-anchor",
        subject: anchor.studio,
        detail: `ICON_TYPES.${anchor.productionIconType} is not in libs/shared/ui-icons/src/icon/types.ts`,
      });
    }
  }

  // Category 4: stale patches. Each token/class patch carries a
  // `sunset_if_absent_from` field pointing at an arcade-gen stylesheet.
  // If the `studio` name no longer appears there, arcade-gen has moved
  // on and the patch can (and should) be deleted from tokens.ts.
  //
  // Resolution: arcade-gen lives in node_modules of the studio workspace,
  // not in devrev-web. We look up the package path from this file's
  // location. When not installed (fresh clone without `pnpm install`)
  // the audit skips these checks rather than failing — a missing package
  // is a different problem than stale patches.
  let patchesChecked = 0;
  const studioWorkspaceRoot = findStudioWorkspaceRoot();
  const arcadeGenRoot = studioWorkspaceRoot
    ? path.join(studioWorkspaceRoot, "node_modules", "@xorkavi", "arcade-gen")
    : null;
  const stylesheetCache = new Map<string, string | null>();
  const readStylesheet = (relPath: string): string | null => {
    if (!arcadeGenRoot) return null;
    if (stylesheetCache.has(relPath)) return stylesheetCache.get(relPath)!;
    const abs = path.join(arcadeGenRoot, relPath);
    const content = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;
    stylesheetCache.set(relPath, content);
    return content;
  };
  const allPatches: Patch[] = [...TOKEN_PATCHES, ...CLASS_PATCHES];
  for (const patch of allPatches) {
    patchesChecked++;
    const content = readStylesheet(patch.sunset_if_absent_from);
    if (content === null) continue; // arcade-gen not installed; skip
    if (!content.includes(patch.studio)) {
      findings.push({
        category: "stale-patch",
        subject: patch.studio,
        detail: `patch target '${patch.studio}' no longer in @xorkavi/arcade-gen/${patch.sunset_if_absent_from}; delete this patch from src/lift/tokens.ts`,
      });
    }
  }

  // Category 5: token resolution. For each audited token, look up its
  // definition in the target's theme CSS and report one of:
  //   - missing:      never defined in the target
  //   - raw-channels: defined as a raw HSL triple (e.g. "0 0% 98%"),
  //                   which silently invalidates when used as a bare
  //                   `var(--X)` in a CSS color property. A render-time
  //                   bug the agent won't see at typecheck.
  // Full-color values (`hsl(...)`, `rgb(...)`, `#rrggbb`) pass silently.
  //
  // Scope notes on the check: we scan a curated set of theme CSS
  // locations under devrev-web and stop at the first definition seen.
  // Raw channels aren't wrong in themselves — plenty of devrev-web
  // utility classes consume them correctly via `hsl(var(--X))`. But the
  // manifest's inline-style_attribute_convention tells the agent to
  // prefer utility classes partly BECAUSE of this. Reporting
  // raw-channels is informational: it tells the manifest author "this
  // token needs an `hsl(...)` wrapper or a matching utility class at
  // use sites — not a bare `var(--X)` inline style."
  const themeCssFiles = [
    "apps/product/styles/light-styles.css",
    "apps/product/styles/dark-styles.css",
    "apps/product/styles/globals.css",
    "apps/product/styles/core-styles.css",
    "libs/design-system/feature/docs/.storybook/styles/light-styles.css",
    "libs/design-system/feature/docs/.storybook/styles/dark-styles.css",
    "libs/design-system/feature/docs/.storybook/styles/core-styles.css",
    "libs/design-system/feature/docs/.storybook/styles/globals.css",
    "libs/design-system/shared/themes/arcade-theme/src/styles/arcade.css",
  ];
  const themeCssText = themeCssFiles
    .map((rel) => {
      const abs = path.join(devrevWebRoot, rel);
      return fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
    })
    .join("\n");
  let tokensChecked = 0;
  const figmaValues = loadFigmaTokenValues();
  for (const token of AUDITED_TOKENS) {
    tokensChecked++;
    const defs = extractTokenDefinitions(themeCssText, token);
    if (defs.length === 0) {
      findings.push({
        category: "token-resolution",
        subject: token,
        detail: `token '${token}' is not defined in any audited theme CSS file`,
      });
      continue;
    }
    // Report if ALL definitions resolve to raw HSL channels (directly
    // OR via one level of `var(--X)` indirection — the common devrev-
    // web pattern of `--foo: var(--bar)` where `--bar` is the raw
    // triple). If at least one definition resolves to a full color,
    // consumers can pick the right form and the convention covers it.
    const resolvedDefs = defs.map((d) => resolveTokenDef(themeCssText, d));
    if (resolvedDefs.every(isRawHslChannels)) {
      findings.push({
        category: "token-resolution",
        subject: token,
        detail: `token '${token}' resolves only to raw HSL channels (${resolvedDefs[0]}); inline \`style={{ ... var(${token}) ... }}\` will silently invalidate — teach the lift to use a utility class or \`hsl(var(${token}))\` arbitrary-value wrapper at use sites.`,
      });
    }

    // Cross-check against the Figma-variable snapshot. If we have a
    // Figma hex for this token, convert the devrev-web value to hex
    // and compare. Mismatches are NOT a manifest bug — they're a
    // platform drift between Figma and the codebase's theme CSS. But
    // the lift agent can't see this, so we log it here.
    const figmaHex = figmaValues.get(token);
    if (figmaHex) {
      // Use the first non-variable definition for the compare. We
      // resolve simple `var(--X)` indirections by walking once, no
      // need for a full DOM-level resolver at audit time.
      const resolvedDef = resolveTokenDef(themeCssText, defs[0]);
      const devrevHex = toHex(resolvedDef);
      if (devrevHex && devrevHex !== figmaHex.toLowerCase()) {
        findings.push({
          category: "figma-value-drift",
          subject: token,
          detail: `Figma says '${token}' = ${figmaHex}; target theme resolves to ${devrevHex}. The lift will be SEMANTICALLY correct (same token name, right slot) but VISUALLY wrong (theme CSS is out of sync with Figma source). Raise with the DS team — no manifest change available.`,
        });
      }
    }
  }

  return {
    findings,
    counts: {
      mappingsChecked,
      priorArtChecked,
      iconAnchorsChecked: ICON_ANCHORS.length,
      patchesChecked,
      tokensChecked,
    },
  };
}

/**
 * Extract all value strings a theme CSS file assigns to a given CSS
 * custom property. We're tolerant of whitespace and indentation, and
 * return every definition we can find so the caller can classify them.
 */
function extractTokenDefinitions(cssText: string, token: string): string[] {
  const re = new RegExp(
    `${escapeRegex(token)}\\s*:\\s*([^;]+?)\\s*(?:;|$)`,
    "g",
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

/**
 * Raw HSL channels look like `0 0% 98%` — three space-separated parts:
 * a hue (number), a saturation with `%`, a lightness with `%`. No
 * `hsl(`, no hex, no named color. Everything else counts as a full
 * color (or an indirection to one, which consumers can resolve).
 */
function isRawHslChannels(value: string): boolean {
  return /^-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?%\s+-?\d+(?:\.\d+)?%$/.test(value);
}

/**
 * Loads a devrev-token → figma-hex map if the user has populated the
 * optional snapshot file. Used for the figma-value-drift check. Missing
 * file or invalid JSON is not an error — the audit simply skips that
 * category.
 */
function loadFigmaTokenValues(): Map<string, string> {
  const out = new Map<string, string>();
  const studioRoot = findStudioWorkspaceRoot();
  if (!studioRoot) return out;
  const abs = path.join(studioRoot, "studio/src/lift/figma-token-values.json");
  if (!fs.existsSync(abs)) return out;
  try {
    const raw = fs.readFileSync(abs, "utf-8");
    const json = JSON.parse(raw) as Record<string, string>;
    for (const [token, hex] of Object.entries(json)) {
      if (token.startsWith("--") && /^#[0-9a-f]{6}$/i.test(hex)) {
        out.set(token, hex.toLowerCase());
      }
    }
  } catch {
    // Swallow; don't fail the whole audit on a bad snapshot file.
  }
  return out;
}

/**
 * Follow `var(--X)` indirections to a terminal value. devrev-web
 * theme chains are commonly 3 deep (semantic → role → scale → raw
 * channels), AND some intermediate tokens are composed of multiple
 * `var(--X)` parts (e.g. `--neutral-920: var(--neutral-h) var(--neutral-s) 92%`).
 * This function:
 *   1. Follows a plain `var(--X)` redirect to its first definition.
 *   2. If the current value contains embedded `var(--X)` parts, inline-
 *      substitutes each one with its first definition.
 *   3. Repeats until the string is stable or the depth cap is hit.
 * Cycle-guarded — if a chain loops we return whatever we have.
 */
const RESOLVE_DEPTH_CAP = 8;

function resolveTokenDef(cssText: string, def: string): string {
  const seen = new Set<string>();
  let current = def.trim();
  for (let i = 0; i < RESOLVE_DEPTH_CAP; i++) {
    const before = current;
    const plainVar = /^var\((--[a-z0-9-]+)\)$/i.exec(current);
    if (plainVar) {
      if (seen.has(plainVar[1])) return current;
      seen.add(plainVar[1]);
      const inner = extractTokenDefinitions(cssText, plainVar[1]);
      if (inner.length === 0) return current;
      current = inner[0].trim();
      continue;
    }
    // Inline-substitute every remaining `var(--X)` reference.
    current = current.replace(
      /var\((--[a-z0-9-]+)\)/gi,
      (_match, ref: string) => {
        if (seen.has(ref)) return _match;
        seen.add(ref);
        const inner = extractTokenDefinitions(cssText, ref);
        return inner.length > 0 ? inner[0].trim() : _match;
      },
    );
    if (current === before) return current;
  }
  return current;
}

/**
 * Convert a CSS color literal to a normalized `#rrggbb` hex string.
 * Returns null for values this function can't confidently convert
 * (css references, raw channels without `hsl(...)` wrapping, named
 * colors). The drift check degrades gracefully — an un-convertible
 * value just doesn't produce a finding.
 */
function toHex(value: string): string | null {
  const v = value.trim();
  // Already a hex.
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(v);
  if (hexMatch) return `#${hexMatch[1].toLowerCase()}`;
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (shortHex) {
    return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`.toLowerCase();
  }
  // hsl(H, S%, L%) or hsl(H S% L%) — support both comma and space syntax.
  const hslMatch =
    /^hsl\(\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)%\s*[, ]\s*(-?\d+(?:\.\d+)?)%\s*\)$/i.exec(
      v,
    );
  if (hslMatch) {
    return hslToHex(
      parseFloat(hslMatch[1]),
      parseFloat(hslMatch[2]),
      parseFloat(hslMatch[3]),
    );
  }
  // Bare raw channels like `0 0% 98%` also happen when the theme stores
  // tokens unwrapped and something indirects to them. Convert as hsl.
  const rawMatch =
    /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/.exec(v);
  if (rawMatch) {
    return hslToHex(
      parseFloat(rawMatch[1]),
      parseFloat(rawMatch[2]),
      parseFloat(rawMatch[3]),
    );
  }
  return null;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hPrime = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const [r1, g1, b1] =
    hPrime < 1
      ? [c, x, 0]
      : hPrime < 2
        ? [x, c, 0]
        : hPrime < 3
          ? [0, c, x]
          : hPrime < 4
            ? [0, x, c]
            : hPrime < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = lig - c / 2;
  const to255 = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to255(r1)}${to255(g1)}${to255(b1)}`.toLowerCase();
}

/**
 * Walks up from this file to find the arcade-prototyper workspace root
 * (the directory holding `pnpm-lock.yaml` + the root `package.json`).
 * Used to locate node_modules/@xorkavi/arcade-gen for patch audits.
 */
function findStudioWorkspaceRoot(): string | null {
  // __dirname equivalents differ across loaders; use the CommonJS-safe path.
  let dir = path.resolve(
    path.dirname(
      typeof __filename === "string"
        ? __filename
        : new URL(import.meta.url).pathname,
    ),
  );
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Reads tsconfig.base.json and returns a Map<specifier, firstPath>.
 * Only the first path is used because every devrev-web alias maps to a
 * single `src/index.ts` in practice.
 */
function loadTsconfigPaths(devrevWebRoot: string): Map<string, string> {
  const tsconfigPath = path.join(devrevWebRoot, "tsconfig.base.json");
  if (!fs.existsSync(tsconfigPath)) {
    throw new Error(
      `tsconfig.base.json not found at ${tsconfigPath}. Pass a correct DEVREV_WEB_ROOT.`,
    );
  }
  const raw = fs.readFileSync(tsconfigPath, "utf-8");
  const json = JSON.parse(raw) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  const paths = json.compilerOptions?.paths ?? {};
  const out = new Map<string, string>();
  for (const [specifier, targets] of Object.entries(paths)) {
    if (targets.length > 0) out.set(specifier, targets[0]);
  }
  return out;
}

/**
 * Cheap grep-based export check. The lift manifest promises a named
 * export exists at the specifier — we don't need a real TS parse for that.
 *
 * Accepts three forms:
 *   1. Direct declarations: `export const Foo`, `export function Foo`, etc.
 *   2. Named re-exports: `export { Foo }`, `export { X as Foo } from '...'`.
 *   3. Wildcard re-exports: `export * from './foo'` — walked recursively up
 *      to `MAX_DEPTH` levels with a cycle guard. devrev-web nx libraries
 *      sometimes chain 3+ levels (e.g. `src/index.ts → pages/index.ts →
 *      list-view-page/index.ts → list-view-page.tsx`).
 */
const MAX_DEPTH = 6;

function hasNamedExport(
  indexFilePath: string,
  exportName: string,
  seen: Set<string> = new Set(),
  depth: number = 0,
): boolean {
  if (depth > MAX_DEPTH) return false;
  const realPath = fs.realpathSync.native
    ? fs.realpathSync.native(indexFilePath)
    : indexFilePath;
  if (seen.has(realPath)) return false;
  seen.add(realPath);

  const text = fs.readFileSync(indexFilePath, "utf-8");

  // 1. Direct declarations.
  const declRe = new RegExp(
    `export\\s+(?:const|function|class|interface|type|enum)\\s+${escapeRegex(
      exportName,
    )}\\b`,
  );
  if (declRe.test(text)) return true;

  // 2. Named re-exports: `export { Foo, Bar as Baz } from '...'` or plain
  // `export { Foo }`. Accept either the direct name or an alias resolving
  // TO it.
  const exportBlockRe = /export\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = exportBlockRe.exec(text)) !== null) {
    const clause = m[1];
    for (const raw of clause.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (raw.startsWith("type ")) {
        if (raw.slice(5).trim() === exportName) return true;
        const asIdx = raw.indexOf(" as ");
        if (asIdx !== -1 && raw.slice(asIdx + 4).trim() === exportName) return true;
        continue;
      }
      const asIdx = raw.indexOf(" as ");
      const exported = asIdx === -1 ? raw : raw.slice(asIdx + 4).trim();
      if (exported === exportName) return true;
    }
  }

  // 3. `export * from './foo'` — walk recursively with depth + cycle guards.
  const wildcardRe = /export\s*\*\s*from\s*["']([^"']+)["']/g;
  while ((m = wildcardRe.exec(text)) !== null) {
    const rel = m[1];
    const dir = path.dirname(indexFilePath);
    for (const candidate of [
      path.join(dir, rel + ".ts"),
      path.join(dir, rel + ".tsx"),
      path.join(dir, rel, "index.ts"),
      path.join(dir, rel, "index.tsx"),
    ]) {
      if (
        fs.existsSync(candidate) &&
        hasNamedExport(candidate, exportName, seen, depth + 1)
      ) {
        return true;
      }
    }
  }

  return false;
}

function iconTypesHas(iconTypesText: string, enumMember: string): boolean {
  const re = new RegExp(`\\b${escapeRegex(enumMember)}\\s*=`);
  return re.test(iconTypesText);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Format a DriftResult for human consumption. Used by both the CLI script
 * and the optional local integration test.
 */
export function formatDriftResult(result: DriftResult): string {
  const lines: string[] = [];
  lines.push(`Lift-manifest drift audit`);
  lines.push(`  mappings checked:    ${result.counts.mappingsChecked}`);
  lines.push(`  prior-art checked:   ${result.counts.priorArtChecked}`);
  lines.push(`  icon anchors:        ${result.counts.iconAnchorsChecked}`);
  lines.push(`  patches checked:     ${result.counts.patchesChecked}`);
  lines.push(`  tokens checked:      ${result.counts.tokensChecked}`);
  lines.push(`  findings:            ${result.findings.length}`);
  if (result.findings.length === 0) {
    lines.push(``);
    lines.push(`✓ clean`);
    return lines.join("\n");
  }
  const byCategory = new Map<DriftFinding["category"], DriftFinding[]>();
  for (const f of result.findings) {
    const arr = byCategory.get(f.category) ?? [];
    arr.push(f);
    byCategory.set(f.category, arr);
  }
  for (const [category, entries] of byCategory) {
    lines.push(``);
    lines.push(`[${category}]`);
    for (const e of entries) {
      lines.push(`  • ${e.subject}: ${e.detail}`);
    }
  }
  return lines.join("\n");
}
