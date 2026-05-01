import type {
  CompactNode, IngestOutcome, IngestResult, IngestFailure, ResolvedTokens,
} from "./figma/types";
import { compactTree } from "./figma/compactTree";
import { resolveTokens } from "./figma/resolveTokens";

export interface IngestDeps {
  getNode: (fileKey: string, nodeId: string) => Promise<any>;
  getVariables: (fileKey: string) => Promise<any | null>;
  exportPng: (fileKey: string, nodeId: string) => Promise<{ path: string; widthPx: number; heightPx: number } | null>;
  classify: (tree: CompactNode, composites: string[]) => Promise<{ composites: IngestResult["composites"]; warnings: string[] }>;
  now?: () => number;
}

export interface IngestConfig {
  composites: string[];
  cacheCapacity?: number;
  cacheTtlMs?: number;
}

export interface FigmaIngest {
  ingest(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome>;
  getCached(fileKey: string, nodeId: string): IngestResult | undefined;
  getPending(fileKey: string, nodeId: string): Promise<IngestOutcome> | undefined;
}

interface CacheEntry { value: IngestResult; expiresAt: number }

export function createFigmaIngest(deps: IngestDeps, cfg: IngestConfig): FigmaIngest {
  const capacity = cfg.cacheCapacity ?? 32;
  const ttlMs = cfg.cacheTtlMs ?? 10 * 60 * 1000;
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<IngestOutcome>>();
  const now = deps.now ?? Date.now;

  function cacheKey(fileKey: string, nodeId: string) { return `${fileKey}:${nodeId}`; }

  function cacheGet(key: string): IngestResult | undefined {
    const e = cache.get(key);
    if (!e) return undefined;
    if (e.expiresAt < now()) { cache.delete(key); return undefined; }
    // Refresh LRU order.
    cache.delete(key); cache.set(key, e);
    return e.value;
  }

  function cacheSet(key: string, value: IngestResult): void {
    cache.set(key, { value, expiresAt: now() + ttlMs });
    while (cache.size > capacity) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  async function runOnce(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome> {
    const warnings: string[] = [];
    let rawDict: any;
    try { rawDict = await deps.getNode(fileKey, nodeId); }
    catch (err: any) {
      const failure: IngestFailure = {
        ok: false,
        reason: `figmanage getNode failed: ${err?.message ?? String(err)}`,
        source: { fileKey, nodeId, url },
      };
      return failure;
    }
    const rawDoc = pickDocument(rawDict, nodeId);
    if (!rawDoc) {
      return { ok: false, reason: "figmanage returned no document for nodeId", source: { fileKey, nodeId, url } };
    }

    const { tree: compacted, warnings: compactWarnings } = compactTree(rawDoc);
    warnings.push(...compactWarnings);

    const varsPayload = await deps.getVariables(fileKey).catch(() => null);
    const { tree: tokenedTree, tokens, warnings: tokenWarnings } = resolveTokens(compacted, rawDoc, varsPayload);
    warnings.push(...tokenWarnings);

    const png = await deps.exportPng(fileKey, nodeId).catch(() => null);
    if (!png) warnings.push("png export failed");

    const { composites, warnings: classifierWarnings } = cfg.composites.length
      ? await deps.classify(tokenedTree, cfg.composites)
      : { composites: [], warnings: [] };
    warnings.push(...classifierWarnings);

    const result: IngestResult = {
      source: { fileKey, nodeId, url, fetchedAt: new Date(now()).toISOString() },
      png,
      tree: tokenedTree,
      tokens,
      composites,
      diagnostics: { warnings },
    };
    cacheSet(cacheKey(fileKey, nodeId), result);
    return { ok: true, ...result };
  }

  async function ingest(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome> {
    const key = cacheKey(fileKey, nodeId);
    const cached = cacheGet(key);
    if (cached) return { ok: true, ...cached };
    const inflight = pending.get(key);
    if (inflight) return inflight;
    const p = runOnce(fileKey, nodeId, url).finally(() => { pending.delete(key); });
    pending.set(key, p);
    return p;
  }

  return {
    ingest,
    getCached(fileKey, nodeId) { return cacheGet(cacheKey(fileKey, nodeId)); },
    getPending(fileKey, nodeId) { return pending.get(cacheKey(fileKey, nodeId)); },
  };
}

function pickDocument(dict: any, nodeId: string): any | null {
  if (!dict || typeof dict !== "object") return null;
  const byId = dict[nodeId] ?? dict[nodeId.replace(":", "-")] ?? Object.values(dict)[0];
  return byId?.document ?? byId ?? null;
}
