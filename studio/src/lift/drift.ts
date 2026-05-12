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
  category: "specifier" | "export" | "prior-art" | "icon-anchor" | "stale-patch";
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
  };
}

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

  return {
    findings,
    counts: {
      mappingsChecked,
      priorArtChecked,
      iconAnchorsChecked: ICON_ANCHORS.length,
      patchesChecked,
    },
  };
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
