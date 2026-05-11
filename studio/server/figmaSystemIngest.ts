import type { SystemIngestOutcome, SystemIngestResult, SynthesizedSections } from "./figma/types";
import type { SystemSources } from "./figma/systemSources";
import { fetchSystemSources as defaultFetch } from "./figma/systemSources";
import { synthesizeSystem as defaultSynth } from "./figma/systemSynth";
import {
  getStyles, getVariables, getComponents, exportNodePng,
} from "./figmaCli";
import { figmaIngestRoot } from "./paths";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn as spawnChild } from "node:child_process";

export interface SystemIngestDeps {
  fetchSources(fileKey: string): Promise<SystemSources>;
  synthesize(sources: SystemSources): Promise<SynthesizedSections>;
  now?: () => number;
}

export interface SystemIngestConfig {
  capacity?: number;
  ttlMs?: number;
  negativeTtlMs?: number;
}

export interface FigmaSystemIngest {
  ingest(fileKey: string): Promise<SystemIngestOutcome>;
  getCached(fileKey: string): SystemIngestResult | undefined;
  getPending(fileKey: string): Promise<SystemIngestOutcome> | undefined;
}

interface PositiveEntry { kind: "ok"; value: SystemIngestResult; expiresAt: number }
interface NegativeEntry { kind: "fail"; reason: string; expiresAt: number }
type CacheEntry = PositiveEntry | NegativeEntry;

export function createFigmaSystemIngest(
  deps: SystemIngestDeps,
  cfg: SystemIngestConfig = {},
): FigmaSystemIngest {
  const capacity = cfg.capacity ?? 8;
  const ttlMs = cfg.ttlMs ?? 60 * 60_000;
  const negativeTtlMs = cfg.negativeTtlMs ?? 5 * 60_000;
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<SystemIngestOutcome>>();
  const now = deps.now ?? Date.now;

  function cacheGet(key: string): CacheEntry | undefined {
    const e = cache.get(key);
    if (!e) return undefined;
    if (e.expiresAt < now()) { cache.delete(key); return undefined; }
    cache.delete(key); cache.set(key, e);
    return e;
  }

  function cacheSet(key: string, entry: CacheEntry): void {
    cache.set(key, entry);
    while (cache.size > capacity) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  async function runIngest(fileKey: string): Promise<SystemIngestOutcome> {
    const startedAt = Date.now();
    try {
      const sources = await deps.fetchSources(fileKey);
      const sections = await deps.synthesize(sources);
      const result: SystemIngestResult = {
        source: {
          fileKey,
          fileName: sources.fileName,
          scannedAt: new Date(now()).toISOString(),
        },
        sections,
        diagnostics: {
          warnings: [...sources.warnings, ...sections.warnings],
          elapsedMs: Date.now() - startedAt,
        },
      };
      cacheSet(fileKey, { kind: "ok", value: result, expiresAt: now() + ttlMs });
      return { ok: true, ...result };
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      cacheSet(fileKey, { kind: "fail", reason, expiresAt: now() + negativeTtlMs });
      return { ok: false, reason };
    }
  }

  return {
    async ingest(fileKey) {
      const cached = cacheGet(fileKey);
      if (cached?.kind === "ok") return { ok: true, ...cached.value };
      if (cached?.kind === "fail") return { ok: false, reason: cached.reason };

      const inFlight = pending.get(fileKey);
      if (inFlight) return inFlight;

      const p = runIngest(fileKey).finally(() => { pending.delete(fileKey); });
      pending.set(fileKey, p);
      return p;
    },
    getCached(fileKey) {
      const e = cache.get(fileKey);
      return e?.kind === "ok" ? e.value : undefined;
    },
    getPending(fileKey) { return pending.get(fileKey); },
  };
}

// --- Production singleton ---

let singleton: FigmaSystemIngest | null = null;

export async function getFigmaSystemIngest(): Promise<FigmaSystemIngest> {
  if (singleton) return singleton;
  singleton = createFigmaSystemIngest({
    fetchSources: (fileKey) => defaultFetch(fileKey, {
      getStyles,
      getVariables,
      getComponents,
      getFile,
      exportPng: async (fk, nodeId) => {
        const dir = figmaIngestRoot();
        await fs.mkdir(dir, { recursive: true });
        const out = path.join(dir, `${fk}_${nodeId.replace(/:/g, "-")}.png`);
        try {
          const fp = await exportNodePng(fk, nodeId, out, 1);
          return { path: fp, widthPx: 0, heightPx: 0 };
        } catch { return null; }
      },
    }),
    synthesize: (sources) => defaultSynth(sources),
  });
  return singleton;
}

async function getFile(fileKey: string): Promise<any | null> {
  // figmanage reading get-file <fk> --json returns the full document tree.
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let proc;
    try {
      proc = spawnChild("figmanage", ["reading", "get-file", fileKey, "--json"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve(null); return;
    }
    proc.stdout!.on("data", (c) => { stdout += c.toString(); });
    proc.stderr!.on("data", (c) => { stderr += c.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      if (code !== 0) { resolve(null); return; }
      try { resolve(JSON.parse(stdout)); }
      catch { resolve(null); }
    });
  });
}
