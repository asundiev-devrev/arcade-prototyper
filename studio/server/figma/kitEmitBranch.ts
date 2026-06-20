/**
 * Kit-emit branch: the no-LLM Figma-import turn.
 *
 * Runs when a prompt contains a Figma URL (and isn't a @Computer turn).
 * Pipeline:
 *   1. figmanage get-nodes → full document tree + component identity maps
 *   2. planAssets → which subtrees need SVG/PNG export
 *   3. figmanage batch export (up to 3 passes: nodes Figma refuses to render
 *      standalone return null URLs; we mark them broken and re-plan, which
 *      recurses into their children)
 *   4. download assets into the frame's assets/ dir (local files — nothing
 *      expires)
 *   5. emitKitFrame → index.tsx with real arcade-gen components where the
 *      curated mapping matches, faithful static markup elsewhere
 *
 * Mirrors runComputerBranch / the old transpile branch: detect → call an
 * external system → write result → narrate → append history.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { StudioEvent } from "../../src/lib/streamJson";
import { frameDir, figmaIngestRoot } from "../paths";
import { appendHistory, nextFramePrefix } from "../projects";
import {
  getNode as figmanageGetNode,
  getVariables as figmanageGetVariables,
  exportNodeImageUrls,
  type BatchExportEntry,
} from "../figmaCli";
import { readPrefetchedRawNode } from "../figmaIngest";
import { planAssets, emitKitFrame, type EmitResult } from "./kitEmit";

export interface KitEmitBranchDeps {
  getNode?: (fileKey: string, nodeId: string) => Promise<any>;
  /**
   * Fetch the file's Figma variable definitions (B1 design tokens). Defaults to
   * figmaCli.getVariables. Returns null on any failure — token resolution then
   * degrades to "all colors as hex" (today's behavior), never blocks the turn.
   * Tests inject this to assert a bound fill emits its kit token.
   */
  getVariables?: (fileKey: string) => Promise<any | null>;
  /**
   * Read a prefetched raw get-nodes dict from the ingest cache (warmed on URL
   * paste), or undefined on miss. Defaults to the figmaIngest singleton's
   * getRawNode. Tests inject this to assert the cache hit skips the live fetch
   * without spinning up the real singleton.
   */
  getRaw?: (fileKey: string, nodeId: string) => any | undefined;
  exportUrls?: (
    fileKey: string,
    nodeIds: string[],
    format: "svg" | "png",
    scale?: number,
  ) => Promise<BatchExportEntry[]>;
  download?: (url: string) => Promise<Buffer>;
  /**
   * Root dir for the A2 cross-import asset cache. Defaults to
   * figmaIngestRoot(). Tests point this at a tmp dir so cache files don't land
   * in the real ~/Library scratch dir and so a hit/miss can be asserted.
   */
  cacheDir?: string;
}

export interface KitEmitBranchInput {
  emit: (ev: StudioEvent) => void;
  slug: string;
  fileKey: string;
  nodeId: string;
  project: { frames?: Array<{ slug: string }> };
  signal: AbortSignal;
  deps?: KitEmitBranchDeps;
  /**
   * Sub-import override. When set, the node is emitted INTO an existing frame
   * dir as a named sibling component (e.g. `Overlay.tsx` exporting `Overlay`)
   * rather than allocated a brand-new frame. Used by the wire-an-interaction
   * flow to pull a modal into the SAME frame as the screen, pixel-exact, so the
   * follow-up LLM pass only has to wire state — never transcribe geometry.
   * A sub-import emits no chat trailer and appends no history (the caller owns
   * the turn's narration). Absent → today's behavior, untouched.
   */
  target?: {
    /** Absolute frame dir to write into (assets land under <fdir>/assets). */
    fdir: string;
    /** Exported component name (default "FigmaImport"). */
    componentName: string;
    /** Entry filename within fdir (default "index.tsx"). */
    entryFileName: string;
  };
}

async function defaultDownload(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Filesystem-safe asset filename for a Figma node id (ids contain `:` and
 *  `;` for nested-instance paths). */
export function assetFileName(nodeId: string, ext: string): string {
  return `${nodeId.replace(/:/g, "-").replace(/;/g, "_")}.${ext}`;
}

/**
 * Version token for the asset cache (A2). The get-nodes dict carries a
 * top-level `version` (a strictly-monotonic id that bumps on EVERY change) and
 * `lastModified` (an ISO timestamp, second-granular). We prefer `version`: it
 * has no granularity collision, whereas two saves within the same wall-clock
 * second share a `lastModified` and would alias to the same cache folder (could
 * serve a pre-edit asset). `lastModified` is the fallback when `version` is
 * absent. Both bump on any file change, so a changed file = a new cache folder,
 * never a stale asset.
 *
 * Returns null when BOTH are absent — the caller then DISABLES the cache for
 * that import (export fresh) rather than risk serving a wrong cached asset.
 */
export function assetCacheVersion(dict: any): string | null {
  const v = dict?.version;
  if (typeof v === "string" && v) return v;
  if (typeof v === "number") return String(v);
  const lm = dict?.lastModified;
  if (typeof lm === "string" && lm) return lm;
  return null;
}

/**
 * Directory that holds cached exported assets for one (fileKey, version),
 * under figmaIngestRoot(). The version folder is the whole invalidation
 * mechanism: a changed Figma file lands in a new folder, leaving the old one
 * orphaned (cheap to GC later, harmless if not). `version` is sanitized into a
 * filesystem-safe token. Returns null when there is no usable version token.
 */
export function assetCacheDir(root: string, fileKey: string, version: string | null): string | null {
  if (!version) return null;
  const safeKey = fileKey.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeVer = version.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(root, "asset-cache", safeKey, safeVer);
}

function frameNameFromNode(nodeId: string): string {
  return `figma-${nodeId.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()}`;
}

/**
 * C3 — coverage telemetry line for the dev console. Turns the emitter's raw
 * counts into "N of M instances are real kit components (P%)" plus the top
 * unmatched set names — the curation backlog (the highest-count names are the
 * best next mappings to add). `topN` caps the backlog list so a huge board
 * doesn't spam the log. Pure + exported so it's unit-testable.
 */
export function formatCoverage(
  result: { totalInstances: number; matchedInstances: number; unmatchedSets: Record<string, number> },
  topN = 5,
): string {
  const { totalInstances, matchedInstances, unmatchedSets } = result;
  const pct = totalInstances > 0 ? Math.round((matchedInstances / totalInstances) * 100) : 0;
  const top = Object.entries(unmatchedSets)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([name, count]) => `${name} ×${count}`);
  const backlog = top.length ? ` — top unmatched: ${top.join(", ")}` : "";
  return `${matchedInstances}/${totalInstances} instances are real kit components (${pct}%)${backlog}`;
}

/** Pull the document for a node out of figmanage's get-nodes response. */
export function pickNodeEntry(dict: any, nodeId: string): {
  document: any;
  components: Record<string, any>;
  componentSets: Record<string, any>;
} | null {
  const nodes = dict?.nodes;
  if (!nodes || typeof nodes !== "object") return null;
  const entry =
    nodes[nodeId] ??
    nodes[nodeId.replace(":", "-")] ??
    (Object.keys(nodes).length === 1 ? nodes[Object.keys(nodes)[0]] : undefined);
  if (!entry?.document) return null;
  return {
    document: entry.document,
    components: entry.components ?? {},
    componentSets: entry.componentSets ?? {},
  };
}

const MAX_EXPORT_PASSES = 3;

export async function runFigmaKitEmitBranch(
  input: KitEmitBranchInput,
): Promise<{ ok: boolean; error?: string; frameSlug?: string; entryPath?: string; componentName?: string }> {
  const { emit, slug, fileKey, nodeId, project, signal } = input;
  const getNode = input.deps?.getNode ?? figmanageGetNode;
  const getVariables = input.deps?.getVariables ?? figmanageGetVariables;
  const exportUrls = input.deps?.exportUrls ?? exportNodeImageUrls;
  const download = input.deps?.download ?? defaultDownload;
  // A1 — prefetch reuse: the /api/figma/ingest prefetch (fired on URL paste)
  // already stashed the raw get-nodes dict. Read it first to skip the ~2s
  // figmanage round-trip on the critical path. Falls through to a live getNode
  // on any miss. The getRaw dep keeps unit tests hermetic; in a real run it's
  // the figmaIngest singleton's getRawNode.
  const getRaw =
    input.deps?.getRaw ??
    ((fk: string, nid: string) => {
      // The ingest singleton is async to construct, but the raw layer is
      // disk-only and synchronous — reading it directly avoids waiting on
      // catalog load. On any miss/error this returns undefined and we fall
      // through to the live fetch, so worst case is today's behavior.
      try { return readPrefetchedRawNode(fk, nid); }
      catch { return undefined; }
    });
  const narrate = (text: string) => emit({ kind: "narration", text });
  const t0 = Date.now();

  narrate("Importing the Figma design (geometry from Figma, components from the kit)…");

  // B1 — design tokens: fetch the file's variable definitions concurrently with
  // the node fetch/export below (it's a separate, ~free figmanage call). Bound
  // color paints will emit kit `var(--x)` tokens instead of baked hex. Resolve
  // null on any failure so token resolution degrades to "all colors hex"
  // (today's behavior) rather than blocking the turn — we await it just before
  // emit, by which point the (longer) node fetch + asset export have run.
  const variablesPromise = Promise.resolve()
    .then(() => getVariables(fileKey))
    .catch(() => null);

  let dict: any;
  const cachedRaw = getRaw(fileKey, nodeId);
  let entry = cachedRaw ? pickNodeEntry(cachedRaw, nodeId) : null;
  if (cachedRaw && entry) {
    dict = cachedRaw;
    console.log(`[kitEmit] reused prefetched get-nodes payload for ${fileKey}:${nodeId} (skipped live fetch)`);
  } else {
    // No prefetched payload, or it didn't contain the node (stale/corrupt
    // cache) — do the live fetch. The cache can never make a node fail that a
    // live fetch would succeed on.
    try {
      dict = await getNode(fileKey, nodeId);
    } catch (err: any) {
      const msg = `Couldn't read the Figma file: ${err?.message ?? String(err)}`;
      narrate(msg);
      return { ok: false, error: msg };
    }
    entry = pickNodeEntry(dict, nodeId);
  }
  if (!entry) {
    const msg = "Figma returned no document for that node — check the link.";
    narrate(msg);
    return { ok: false, error: msg };
  }
  if (signal.aborted) return { ok: false, error: "cancelled" };

  const { document: doc, components, componentSets } = entry;

  // Allocate frame slug + dir; assets land under it. A sub-import (target set)
  // writes into an existing frame dir as a named sibling component instead of
  // allocating a new frame.
  const target = input.target;
  const existing = (project.frames ?? []).map((f) => f.slug);
  const frameSlug = `${nextFramePrefix(existing)}-${frameNameFromNode(nodeId)}`;
  const fdir = target ? target.fdir : frameDir(slug, frameSlug);
  const componentName = target?.componentName ?? "FigmaImport";
  const entryFileName = target?.entryFileName ?? "index.tsx";
  const assetsDir = path.join(fdir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });

  // --- A2: asset cache across imports -------------------------------------
  // Exported SVG/PNG bytes are immutable per file version. Cache them on disk
  // keyed by fileKey:version:nodeId:format so a re-import of the same node
  // skips the Figma export+download entirely. The version-keyed folder makes
  // invalidation a no-op: a changed Figma file lands in a new folder.
  const cacheRoot = input.deps?.cacheDir ?? figmaIngestRoot();
  const cacheVersion = assetCacheVersion(dict);
  const cacheDir = assetCacheDir(cacheRoot, fileKey, cacheVersion);
  let cacheHits = 0;

  /** Path of the cached file for (nodeId, format) under the version dir, or
   *  null when the cache is disabled (no version token). */
  const cachePathFor = (id: string, format: "svg" | "png"): string | null =>
    cacheDir ? path.join(cacheDir, assetFileName(id, format)) : null;

  /** Cache HIT: copy the cached bytes into the frame's assets/ dir and record
   *  the file. Returns true when a valid, non-empty cache file was used. */
  const tryCacheHit = async (id: string, format: "svg" | "png"): Promise<boolean> => {
    const cp = cachePathFor(id, format);
    if (!cp) return false;
    try {
      const st = await fs.stat(cp);
      if (!st.isFile() || st.size === 0) return false; // corrupt/empty → miss
      const file = assetFileName(id, format);
      await fs.copyFile(cp, path.join(assetsDir, file));
      assetFiles.set(id, file);
      cacheHits++;
      return true;
    } catch {
      return false; // not cached / unreadable → treat as miss, export fresh
    }
  };

  /** Best-effort write of freshly-downloaded bytes into the version cache. A
   *  failure here never aborts the turn (mirrors the ingest diskSet posture). */
  const writeCache = async (id: string, format: "svg" | "png", bytes: Buffer): Promise<void> => {
    const cp = cachePathFor(id, format);
    if (!cp) return;
    try {
      await fs.mkdir(path.dirname(cp), { recursive: true });
      await fs.writeFile(cp, bytes);
    } catch (err: any) {
      console.warn(`[kitEmit] asset cache write failed for ${id}.${format}: ${err?.message ?? err}`);
    }
  };

  // --- Asset export: plan → export → mark broken → re-plan (≤3 passes) ----
  const brokenIds = new Set<string>();
  const assetFiles = new Map<string, string>(); // nodeId -> filename
  const downloadFailures: string[] = [];

  const fetchBatch = async (ids: string[], format: "svg" | "png", scale: number): Promise<string[]> => {
    const pending = ids.filter((id) => !assetFiles.has(id));
    if (!pending.length) return [];

    // A2: serve from the version cache first; only export the ids that miss.
    const toExport: string[] = [];
    for (const id of pending) {
      if (!(await tryCacheHit(id, format))) toExport.push(id);
    }
    if (!toExport.length) return [];

    const entries = await exportUrls(fileKey, toExport, format, scale);
    const broken: string[] = [];
    await Promise.all(entries.map(async (e) => {
      if (!e.url) { broken.push(e.nodeId); return; }
      try {
        const bytes = await download(e.url);
        const file = assetFileName(e.nodeId, format);
        await fs.writeFile(path.join(assetsDir, file), bytes);
        assetFiles.set(e.nodeId, file);
        // Populate the version cache so the next import is a hit.
        await writeCache(e.nodeId, format, bytes);
      } catch (err: any) {
        downloadFailures.push(`${e.nodeId}: ${err?.message ?? String(err)}`);
      }
    }));
    return broken;
  };

  try {
    let plan = planAssets(doc, { components, componentSets, brokenIds });
    narrate(`Exporting ${plan.svgIds.length + plan.pngIds.length} assets from Figma…`);
    for (let pass = 0; pass < MAX_EXPORT_PASSES; pass++) {
      if (signal.aborted) return { ok: false, error: "cancelled" };
      // SVG and PNG exports are independent (disjoint ids, formats, files) —
      // run them concurrently instead of serializing the two Figma round-trips.
      // Halves the asset phase (~4.4s → 2.5s on a full board).
      const [brokenSvg, brokenPng] = await Promise.all([
        fetchBatch(plan.svgIds, "svg", 1),
        fetchBatch(plan.pngIds, "png", 2),
      ]);
      const broken = [...brokenSvg, ...brokenPng];
      if (!broken.length) break;
      broken.forEach((id) => brokenIds.add(id));
      plan = planAssets(doc, { components, componentSets, brokenIds });
    }
  } catch (err: any) {
    const msg = `Asset export failed: ${err?.message ?? String(err)}`;
    narrate(msg);
    return { ok: false, error: msg };
  }

  if (signal.aborted) return { ok: false, error: "cancelled" };

  // --- Emit + write -------------------------------------------------------
  // The variables fetch was kicked off at the top; it has had the whole node
  // fetch + asset export to complete, so this await is effectively free.
  const variables = await variablesPromise;

  let result: EmitResult;
  try {
    result = emitKitFrame(doc, {
      components,
      componentSets,
      brokenIds,
      assetFiles,
      variables,
      componentName,
    });
  } catch (err: any) {
    const msg = `Couldn't generate the frame: ${err?.message ?? String(err)}`;
    narrate(msg);
    return { ok: false, error: msg };
  }

  // Entry file LAST so the watcher's reload sees assets present.
  await fs.writeFile(path.join(fdir, entryFileName), result.source, "utf-8");
  console.log(`[kitEmit] ${frameSlug}: ${result.kitInstanceCount} kit instances, ${result.assetRefs.length} assets (${cacheHits} from cache), ${result.tokenizedColors} tokens / ${result.hexColors} hex, ${Date.now() - t0}ms`);
  // C3 — per-import kit-coverage telemetry. Turns "coverage" from a guess into a
  // tracked number; the unmatched list is the curation backlog (which set names
  // to map next). Logged unconditionally so every import leaves a trail.
  console.log(`[kitEmit] ${frameSlug} coverage: ${formatCoverage(result)}`);
  if (result.hexColors > 0) {
    // Unbound (or non-kit-resolvable) colors stay literal hex — fidelity-safe,
    // but each is a coverage gap. Count them so we can grow the mapping.
    console.warn(`[kitEmit] ${frameSlug}: ${result.hexColors} color${result.hexColors === 1 ? "" : "s"} emitted as raw hex (no kit token binding); ${result.tokenizedColors} resolved to design tokens.`);
  }

  if (downloadFailures.length) {
    narrate(`⚠ ${downloadFailures.length} asset${downloadFailures.length === 1 ? "" : "s"} couldn't be downloaded and may render as plain boxes.`);
  }

  // A sub-import is one half of a larger turn — the caller (the wire-up flow)
  // owns the chat trailer + history. Return early with the written paths so it
  // can wire the component in.
  if (target) {
    return { ok: true, frameSlug, entryPath: path.join(fdir, entryFileName), componentName };
  }

  const compNames = result.kitImports.join(", ");
  const trailer =
    `Imported from Figma with exact geometry. ${result.kitInstanceCount} elements are real kit components` +
    (compNames ? ` (${compNames})` : "") +
    "; unmatched elements are faithful static markup with locally exported assets. " +
    "Tell me what to change or which interactions to wire next.";
  narrate(trailer);

  await appendHistory(slug, {
    id: `a-${Date.now()}`,
    role: "assistant",
    content: trailer,
    createdAt: new Date().toISOString(),
  });

  return { ok: true, frameSlug };
}
