/**
 * The frame-slug naming transform, as a LEAF module with zero imports.
 *
 * WHY THIS FILE EXISTS SEPARATELY. This one-liner used to live inside
 * kitEmitBranch.ts, which is the most Studio-coupled module in the Figma tree:
 * its static import closure reaches server/paths.ts (os.homedir() +
 * ~/Library/Application Support/arcade-studio), server/figmaCli.ts
 * (node:child_process → figmanage), server/figmaIngest.ts, and
 * server/claudeBin.ts (resolveClaudeBin). server/figma/provenance.ts needs the
 * transform and nothing else, and provenance.ts must stay BRAIN — loadable in a
 * Claude Code / Cursor / Computer host with no Studio filesystem, no CLI binary,
 * and possibly no macOS. Importing it from kitEmitBranch would have re-coupled
 * the brain to the app TRANSITIVELY, which a per-file source grep cannot see.
 *
 * Compare the `import-hook-dead-in-dmg` failure one level up: a dev-only path
 * silently disabled a whole feature on tester machines while every test passed.
 *
 * So: both kitEmitBranch (the writer) and provenance (the reader) import this,
 * and there is still exactly ONE copy of the transform — the drift discipline
 * src/lib/scopedEdit.ts exists to enforce.
 *
 * Pure. No imports, no I/O, no process.env. Do not add any.
 */

/**
 * The directory-name form of a Figma node id, as written by the deterministic
 * importer: `5678:118876` → `figma-5678-118876`. The emitted frame slug is this
 * with a two-digit ordinal prefix, e.g. `01-figma-5678-118876`.
 */
export function frameNameFromNode(nodeId: string): string {
  return `figma-${nodeId.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()}`;
}

/**
 * True when `slug` is the frame the deterministic importer would have written
 * for `nodeId`.
 *
 * The comparison is EXACT after stripping the ordinal prefix, deliberately — not
 * `includes` and not `startsWith`. Node ids are variable-length digit strings, so
 * a substring test collides between sibling nodes:
 * `'01-figma-5678-118876'.includes('figma-5678-11887')` is **true**. That would
 * name a frame the designer was not talking about, and confidently naming the
 * wrong frame is worse than naming none (the generator edits it without
 * hesitating, and the designer's next turn is a second correction about a third
 * frame).
 */
export function slugMatchesNode(slug: string, nodeId: string): boolean {
  if (typeof slug !== "string" || typeof nodeId !== "string") return false;
  return slug.replace(/^\d+-/, "").toLowerCase() === frameNameFromNode(nodeId);
}
