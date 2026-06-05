import type {
  CompactNode, IngestOutcome, IngestResult, IngestFailure, ResolvedTokens,
} from "./figma/types";
import { compactTree } from "./figma/compactTree";
import { resolveTokens } from "./figma/resolveTokens";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import {
  exportNodePng,
  getNode as figmanageGetNode,
  getVariables as figmanageGetVariables,
} from "./figmaCli";
import { classifyComposites } from "./figma/classifyComposites";
import { figmaIngestRoot } from "./paths";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  /** When set, IngestResults are persisted as JSON here so the cache survives
   *  a Studio restart / a fresh project session. Omit (e.g. in unit tests) to
   *  keep the cache purely in-memory. */
  diskDir?: string;
  /** TTL for the on-disk layer. Defaults to 1h. */
  diskTtlMs?: number;
}

export interface FigmaIngest {
  /**
   * Full ingest — runs phase 1 (tree + tokens + PNG) then phase 2 (classifier)
   * and returns the combined IngestResult. Use from places that can afford to
   * wait the full wall-clock (tests; explicit "give me everything" callers).
   */
  ingest(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome>;
  /**
   * Phase-1 ingest — returns as soon as tree + tokens + PNG are ready,
   * typically 3–8s. Phase 2 (classifier) runs in the background afterward and
   * silently upgrades the cached IngestResult in place when it finishes, so
   * the NEXT call for the same (fileKey, nodeId) sees composites populated.
   */
  ingestPhase1(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome>;
  /**
   * Whatever is currently cached — may be phase-1-only (composites=[]) or
   * phase-2-complete (composites=[…]). Returns undefined on miss.
   */
  getCached(fileKey: string, nodeId: string): IngestResult | undefined;
  /**
   * Phase-1 pending promise for dedupe. Returns undefined if no phase-1 is
   * currently in flight. Callers that want "give me whatever's available"
   * should await this with their own timeout.
   */
  getPhase1Pending(fileKey: string, nodeId: string): Promise<IngestOutcome> | undefined;
}

interface CacheEntry { value: IngestResult; expiresAt: number }

export function createFigmaIngest(deps: IngestDeps, cfg: IngestConfig): FigmaIngest {
  const capacity = cfg.cacheCapacity ?? 32;
  const ttlMs = cfg.cacheTtlMs ?? 10 * 60 * 1000;
  // Disk cache TTL is longer than the in-memory one: the point of the disk
  // layer is to survive a Studio restart / a fresh project session, where the
  // in-memory LRU is empty but the same Figma frame is being reopened. The
  // PNG export is already on disk; persisting the JSON result beside it means
  // reopening a project doesn't re-pay the 3–8s figmanage round-trip.
  const diskTtlMs = cfg.diskTtlMs ?? 60 * 60 * 1000;
  const diskDir = cfg.diskDir;
  const cache = new Map<string, CacheEntry>();
  const phase1Pending = new Map<string, Promise<IngestOutcome>>();
  const phase2Pending = new Map<string, Promise<void>>();
  const now = deps.now ?? Date.now;

  function cacheKey(fileKey: string, nodeId: string) { return `${fileKey}:${nodeId}`; }

  function diskPathFor(key: string): string | null {
    if (!diskDir) return null;
    // key is `${fileKey}:${nodeId}` — sanitize for a filename.
    const safe = key.replace(/[^A-Za-z0-9_-]/g, "_");
    return path.join(diskDir, `${safe}.ingest.json`);
  }

  function cacheGet(key: string): IngestResult | undefined {
    const e = cache.get(key);
    if (!e) {
      // In-memory miss: try the disk layer (survives restarts / new sessions).
      const hydrated = diskGet(key);
      if (hydrated) {
        // Promote into the in-memory LRU at the in-memory TTL.
        cache.set(key, { value: hydrated, expiresAt: now() + ttlMs });
        return hydrated;
      }
      return undefined;
    }
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
    diskSet(key, value);
  }

  /** Read a persisted IngestResult from disk, honoring diskTtlMs. Synchronous
   *  is intentional: cacheGet is called on the hot path and the file is tiny;
   *  a sync read keeps the cache API non-async. Any error → treated as a miss. */
  function diskGet(key: string): IngestResult | undefined {
    const p = diskPathFor(key);
    if (!p) return undefined;
    try {
      const raw = fsSync.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw) as { savedAt: number; value: IngestResult };
      if (!parsed?.savedAt || now() - parsed.savedAt > diskTtlMs) return undefined;
      // Guard against a stale PNG path: if the export file is gone, drop the
      // png reference rather than handing the agent a dead path.
      if (parsed.value.png && !fsSync.existsSync(parsed.value.png.path)) {
        parsed.value.png = null;
      }
      return parsed.value;
    } catch {
      return undefined;
    }
  }

  /** Persist an IngestResult to disk. Best-effort, fire-and-forget; a write
   *  failure never blocks or breaks the turn. */
  function diskSet(key: string, value: IngestResult): void {
    const p = diskPathFor(key);
    if (!p) return;
    const payload = JSON.stringify({ savedAt: now(), value });
    void fs.mkdir(path.dirname(p), { recursive: true })
      .then(() => fs.writeFile(p, payload))
      .catch((err) => {
        console.warn(`[figmaIngest] disk cache write failed for ${key}: ${err?.message ?? err}`);
      });
  }

  /**
   * Phase 1: figmanage fetch + compact + token resolve + PNG export.
   * Deterministic, no LLM. Returns an IngestResult with composites=[].
   * Caches the result so chat.ts can grab it immediately; phase 2 will
   * upgrade the same cache entry in place when it finishes.
   */
  async function runPhase1(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome> {
    const startedAt = Date.now();
    const warnings: string[] = [];
    let rawDict: any;
    try { rawDict = await deps.getNode(fileKey, nodeId); }
    catch (err: any) {
      const failure: IngestFailure = {
        ok: false,
        reason: `figmanage getNode failed: ${err?.message ?? String(err)}`,
        source: { fileKey, nodeId, url },
      };
      console.warn(`[figmaIngest] phase=1 fileKey=${fileKey} nodeId=${nodeId} failed: ${failure.reason}`);
      return failure;
    }
    const rawDoc = pickDocument(rawDict, nodeId);
    if (!rawDoc) {
      const reason = "figmanage returned no document for nodeId";
      console.warn(`[figmaIngest] phase=1 fileKey=${fileKey} nodeId=${nodeId} failed: ${reason}`);
      return { ok: false, reason, source: { fileKey, nodeId, url } };
    }

    const { tree: compacted, warnings: compactWarnings } = compactTree(rawDoc);
    warnings.push(...compactWarnings);

    // getVariables (token JSON) and exportPng (rendered screenshot) are two
    // independent figmanage round-trips. Run them concurrently — the PNG
    // export does NOT depend on the variables payload, and serializing them
    // was doubling the network wait on the cold path (the single biggest
    // contributor to fresh-Figma turn-start latency). resolveTokens still
    // waits on getVariables, but the PNG fetch overlaps it.
    const [varsPayload, png] = await Promise.all([
      deps.getVariables(fileKey).catch(() => null),
      deps.exportPng(fileKey, nodeId).catch(() => null),
    ]);
    const { tree: tokenedTree, tokens, warnings: tokenWarnings } = resolveTokens(compacted, rawDoc, varsPayload);
    warnings.push(...tokenWarnings);

    if (!png) warnings.push("png export failed");

    const result: IngestResult = {
      source: { fileKey, nodeId, url, fetchedAt: new Date(now()).toISOString() },
      png,
      tree: tokenedTree,
      tokens,
      composites: [],
      diagnostics: { warnings },
    };
    cacheSet(cacheKey(fileKey, nodeId), result);

    const nodeCount = countNodes(tokenedTree);
    const ms = Date.now() - startedAt;
    console.log(
      `[figmaIngest] phase=1 fileKey=${fileKey} nodeId=${nodeId} ms=${ms} nodes=${nodeCount} warnings=${warnings.length}${warnings.length ? ` [${warnings.join(" | ")}]` : ""}`,
    );

    return { ok: true, ...result };
  }

  /**
   * Phase 2: classifier. Runs against whatever's in the cache at start time;
   * on success, upgrades the cache entry in place with the new composites.
   * Never throws — the classifier is best-effort, and phase 1 already
   * satisfied the chat turn by the time this runs.
   */
  async function runPhase2(fileKey: string, nodeId: string): Promise<void> {
    if (!cfg.composites.length) return;
    const key = cacheKey(fileKey, nodeId);
    const base = cacheGet(key);
    if (!base) return;

    const startedAt = Date.now();
    let classifier: { composites: IngestResult["composites"]; warnings: string[] };
    try {
      classifier = await deps.classify(base.tree, cfg.composites);
    } catch (err: any) {
      console.warn(`[figmaIngest] phase=2 fileKey=${fileKey} nodeId=${nodeId} failed: ${err?.message ?? String(err)}`);
      return;
    }

    // Cache may have been evicted or replaced while phase 2 ran. Re-read and
    // only upgrade if the cached entry still matches the tree we classified.
    const current = cacheGet(key);
    if (!current || current.tree !== base.tree) return;

    const upgraded: IngestResult = {
      ...current,
      composites: classifier.composites,
      diagnostics: {
        warnings: [...current.diagnostics.warnings, ...classifier.warnings],
      },
    };
    cacheSet(key, upgraded);

    const ms = Date.now() - startedAt;
    console.log(
      `[figmaIngest] phase=2 fileKey=${fileKey} nodeId=${nodeId} ms=${ms} composites=${classifier.composites.length} warnings=${classifier.warnings.length}${classifier.warnings.length ? ` [${classifier.warnings.join(" | ")}]` : ""}`,
    );
  }

  async function ingestPhase1(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome> {
    const key = cacheKey(fileKey, nodeId);
    const cached = cacheGet(key);
    if (cached) return { ok: true, ...cached };

    const existing = phase1Pending.get(key);
    if (existing) return existing;

    const p = runPhase1(fileKey, nodeId, url).finally(() => { phase1Pending.delete(key); });
    phase1Pending.set(key, p);

    // Kick off phase 2 to run in the background as soon as phase 1 succeeds.
    // We attach the phase-2 promise to a separate pending map so multiple
    // prefetches don't start redundant classifiers.
    if (!phase2Pending.has(key)) {
      const p2 = p.then(async (outcome) => {
        if (!outcome.ok) return;
        await runPhase2(fileKey, nodeId);
      }).finally(() => { phase2Pending.delete(key); });
      phase2Pending.set(key, p2);
    }

    return p;
  }

  async function ingest(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome> {
    const key = cacheKey(fileKey, nodeId);
    const phase1Outcome = await ingestPhase1(fileKey, nodeId, url);
    if (!phase1Outcome.ok) return phase1Outcome;
    // ingest() is the "wait for everything" entry point — also wait for the
    // in-flight phase 2 to finish if one exists, so the returned result
    // includes classifier output.
    const p2 = phase2Pending.get(key);
    if (p2) { try { await p2; } catch { /* phase 2 swallows its own errors */ } }
    const final = cacheGet(key) ?? { ...phase1Outcome };
    // Strip the `ok` tag before re-spreading — callers of ingest expect
    // IngestOutcome, so we tack it back on.
    const { ok, ...rest } = final as any;
    void ok;
    return { ok: true, ...rest };
  }

  return {
    ingest,
    ingestPhase1,
    getCached(fileKey, nodeId) { return cacheGet(cacheKey(fileKey, nodeId)); },
    getPhase1Pending(fileKey, nodeId) { return phase1Pending.get(cacheKey(fileKey, nodeId)); },
  };
}

function countNodes(node: CompactNode): number {
  let n = 1;
  for (const c of node.children ?? []) n += countNodes(c);
  return n;
}

function pickDocument(dict: any, nodeId: string): any | null {
  if (!dict || typeof dict !== "object") return null;

  // Our unit-test fixtures use a flat shape: { <nodeId>: { document } }.
  const direct = dict[nodeId]?.document ?? dict[nodeId.replace(":", "-")]?.document;
  if (direct && typeof direct === "object") return direct;

  // figmanage's real shape wraps everything in `.nodes`:
  //   { nodes: { <nodeId>: { document } }, name, editorType, ... }
  const nodes = dict.nodes;
  if (nodes && typeof nodes === "object") {
    const viaWrapper = nodes[nodeId]?.document ?? nodes[nodeId.replace(":", "-")]?.document;
    if (viaWrapper && typeof viaWrapper === "object") return viaWrapper;
    const keys = Object.keys(nodes);
    if (keys.length === 1) {
      const only = nodes[keys[0]]?.document;
      if (only && typeof only === "object") return only;
    }
  }
  return null;
}

let singleton: FigmaIngest | null = null;
let cataloging: Promise<string[]> | null = null;

export async function getFigmaIngest(): Promise<FigmaIngest> {
  if (singleton) return singleton;
  cataloging ??= loadCompositeCatalog();
  const composites = await cataloging;
  singleton = createFigmaIngest(
    {
      getNode: (fileKey, nodeId) => figmanageGetNode(fileKey, nodeId),
      getVariables: (fileKey) => figmanageGetVariables(fileKey),
      exportPng: async (fileKey, nodeId) => {
        const dir = figmaIngestRoot();
        await fs.mkdir(dir, { recursive: true });
        const out = path.join(dir, `${fileKey}_${nodeId.replace(/:/g, "-")}.png`);
        try {
          const filepath = await exportNodePng(fileKey, nodeId, out, 2);
          return { path: filepath, widthPx: 0, heightPx: 0 };
        } catch { return null; }
      },
      classify: (tree, names) => classifyComposites(tree, names),
    },
    {
      composites,
      cacheCapacity: 32,
      cacheTtlMs: 10 * 60_000,
      // Persist beside the PNG exports so reopening a Figma frame in a new
      // session is a cache hit instead of a 3–8s re-fetch.
      diskDir: figmaIngestRoot(),
      diskTtlMs: 60 * 60_000,
    },
  );
  return singleton;
}

async function loadCompositeCatalog(): Promise<string[]> {
  try {
    const manifest = await fs.readFile(
      path.resolve(__dirname, "..", "prototype-kit", "KIT-MANIFEST.md"),
      "utf-8",
    );
    const names = new Set<string>();
    for (const m of manifest.matchAll(/^##\s+([A-Za-z][A-Za-z0-9]+)\s*\((?:composite|template)\)/gm)) {
      names.add(m[1]);
    }
    return [...names];
  } catch {
    return [];
  }
}
