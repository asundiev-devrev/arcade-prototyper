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
  exportNodeImageUrls,
  type BatchExportEntry,
} from "../figmaCli";
import { readPrefetchedRawNode } from "../figmaIngest";
import { planAssets, emitKitFrame, type EmitResult } from "./kitEmit";

export interface KitEmitBranchDeps {
  getNode?: (fileKey: string, nodeId: string) => Promise<any>;
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
 * top-level `lastModified` (preferred) and `version` (fallback) — both bump
 * whenever the Figma file changes ANYWHERE, which over-invalidates slightly but
 * is always safe: a changed file = a new cache folder, never a stale asset.
 *
 * Returns null when BOTH are absent — the caller then DISABLES the cache for
 * that import (export fresh) rather than risk serving a wrong cached asset.
 */
export function assetCacheVersion(dict: any): string | null {
  const lm = dict?.lastModified;
  if (typeof lm === "string" && lm) return lm;
  const v = dict?.version;
  if (typeof v === "string" && v) return v;
  if (typeof v === "number") return String(v);
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
): Promise<{ ok: boolean; error?: string }> {
  const { emit, slug, fileKey, nodeId, project, signal } = input;
  const getNode = input.deps?.getNode ?? figmanageGetNode;
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

  // Allocate frame slug + dir; assets land under it.
  const existing = (project.frames ?? []).map((f) => f.slug);
  const frameSlug = `${nextFramePrefix(existing)}-${frameNameFromNode(nodeId)}`;
  const fdir = frameDir(slug, frameSlug);
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
  let result: EmitResult;
  try {
    result = emitKitFrame(doc, {
      components,
      componentSets,
      brokenIds,
      assetFiles,
      componentName: "FigmaImport",
    });
  } catch (err: any) {
    const msg = `Couldn't generate the frame: ${err?.message ?? String(err)}`;
    narrate(msg);
    return { ok: false, error: msg };
  }

  // index.tsx LAST so the watcher's reload sees assets present.
  await fs.writeFile(path.join(fdir, "index.tsx"), result.source, "utf-8");
  console.log(`[kitEmit] ${frameSlug}: ${result.kitInstanceCount} kit instances, ${result.assetRefs.length} assets (${cacheHits} from cache), ${Date.now() - t0}ms`);

  if (downloadFailures.length) {
    narrate(`⚠ ${downloadFailures.length} asset${downloadFailures.length === 1 ? "" : "s"} couldn't be downloaded and may render as plain boxes.`);
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

  return { ok: true };
}
