#!/usr/bin/env node
// PostToolUse hook: validate named imports from "arcade/components" and
// "arcade-prototypes" against the real barrels. Blocks Write/Edit tool
// calls that introduce hallucinated names (e.g. ArrowsUpDownSmall), with
// Did-you-mean suggestions so the agent can self-correct in the same turn.
//
// Mirrors the shape of blockImageReshape.mjs: pure-function exports for
// tests, plus a main() that reads stdin and exits 0 or 2. Fails open on
// any parse/runtime error — a broken hook must not wedge a real generation.

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
