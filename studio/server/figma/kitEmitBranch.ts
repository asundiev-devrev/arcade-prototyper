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
import { frameDir } from "../paths";
import { appendHistory, nextFramePrefix } from "../projects";
import {
  getNode as figmanageGetNode,
  exportNodeImageUrls,
  type BatchExportEntry,
} from "../figmaCli";
import { planAssets, emitKitFrame, type EmitResult } from "./kitEmit";

export interface KitEmitBranchDeps {
  getNode?: (fileKey: string, nodeId: string) => Promise<any>;
  exportUrls?: (
    fileKey: string,
    nodeIds: string[],
    format: "svg" | "png",
    scale?: number,
  ) => Promise<BatchExportEntry[]>;
  download?: (url: string) => Promise<Buffer>;
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
  const narrate = (text: string) => emit({ kind: "narration", text });
  const t0 = Date.now();

  narrate("Importing the Figma design (geometry from Figma, components from the kit)…");

  let dict: any;
  try {
    dict = await getNode(fileKey, nodeId);
  } catch (err: any) {
    const msg = `Couldn't read the Figma file: ${err?.message ?? String(err)}`;
    narrate(msg);
    return { ok: false, error: msg };
  }
  const entry = pickNodeEntry(dict, nodeId);
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

  // --- Asset export: plan → export → mark broken → re-plan (≤3 passes) ----
  const brokenIds = new Set<string>();
  const assetFiles = new Map<string, string>(); // nodeId -> filename
  const downloadFailures: string[] = [];

  const fetchBatch = async (ids: string[], format: "svg" | "png", scale: number): Promise<string[]> => {
    const pending = ids.filter((id) => !assetFiles.has(id));
    if (!pending.length) return [];
    const entries = await exportUrls(fileKey, pending, format, scale);
    const broken: string[] = [];
    await Promise.all(entries.map(async (e) => {
      if (!e.url) { broken.push(e.nodeId); return; }
      try {
        const bytes = await download(e.url);
        const file = assetFileName(e.nodeId, format);
        await fs.writeFile(path.join(assetsDir, file), bytes);
        assetFiles.set(e.nodeId, file);
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
  console.log(`[kitEmit] ${frameSlug}: ${result.kitInstanceCount} kit instances, ${result.assetRefs.length} assets, ${Date.now() - t0}ms`);

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
