/**
 * Generation telemetry — one JSONL row per turn, plus an aggregator.
 *
 * Why this exists: every latency decision for the generator has been an
 * estimate because the app measured nothing. The Claude CLI already computes
 * ttft_ms / duration_ms / num_turns / token usage / cost on its `result` line
 * (surfaced as a `turn_metrics` StudioEvent); studio adds what only it knows
 * (turn type, frame size, stalls, retries). We append both to a JSONL log and
 * aggregate on demand. No external service, no UI dependency — durable data
 * that turns "we think edits are ~28% of turns" into a fact.
 */
import fs from "node:fs/promises";
import { metricsLogPath } from "./paths";

/** One persisted turn. All fields optional except the stamp — a row is still
 *  useful (counts a turn, records failure) even when the CLI omitted usage. */
export interface TurnMetric {
  /** ISO timestamp the turn ended. */
  at: string;
  slug: string;
  /** "claude" generation vs "computer" agent turn. */
  source: "claude" | "computer";
  ok: boolean;
  /** Did the turn change a file, and which way — the edit-vs-build signal. */
  turnType: "build" | "edit" | "none";
  /** Lines in the frame the turn wrote (when it wrote one). */
  frameLines?: number;
  /** Whether a Bedrock stall fired this turn, and how many retries it cost. */
  stalled?: boolean;
  retries?: number;
  promptChars?: number;
  // --- from the CLI result line (turn_metrics event) ---
  durationMs?: number;
  ttftMs?: number;
  numTurns?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

/**
 * Append one turn metric. Best-effort: a write failure logs a warning and is
 * swallowed — telemetry must never break or slow a turn. Single-line JSON so
 * the file is append-only and crash-safe (a torn final line is just dropped by
 * the reader).
 */
export async function recordTurnMetric(m: TurnMetric): Promise<void> {
  try {
    await fs.appendFile(metricsLogPath(), JSON.stringify(m) + "\n");
  } catch (err) {
    console.warn("[studio] metrics append failed:", err instanceof Error ? err.message : err);
  }
}

export interface MetricsSummary {
  turns: number;
  okRate: number;
  /** Share of turns by type. */
  byType: { build: number; edit: number; none: number };
  /** Latency percentiles (ms) over turns that reported duration. */
  durationMs: { p50: number; p90: number; max: number; n: number };
  ttftMs: { p50: number; p90: number; max: number; n: number };
  /** Mean round-trips per turn (CLI num_turns). */
  avgNumTurns: number | null;
  /** Cache reuse: share of turns whose first call read from cache (warm). */
  cacheHitRate: number | null;
  /** Stall frequency — the churn signal. */
  stallRate: number;
  /** Model mix (count by resolved model id). Catches users on a slow model. */
  models: Record<string, number>;
  /** Median frame size on build turns — the hand-roll-vs-composite signal. */
  frameLinesMedian: number | null;
  totalCostUsd: number;
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[i];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Read the log and compute a summary. `sinceMs` optionally limits to rows
 *  whose `at` is newer than that epoch-ms cutoff. Tolerant of torn lines. */
export async function summarizeMetrics(sinceMs?: number): Promise<MetricsSummary> {
  let raw = "";
  try { raw = await fs.readFile(metricsLogPath(), "utf-8"); }
  catch { /* no log yet → empty summary */ }

  const rows: TurnMetric[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as TurnMetric;
      if (sinceMs && Date.parse(r.at) < sinceMs) continue;
      rows.push(r);
    } catch { /* torn / malformed line — skip */ }
  }

  const turns = rows.length;
  const durations = rows.map((r) => r.durationMs).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const ttfts = rows.map((r) => r.ttftMs).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const numTurnsVals = rows.map((r) => r.numTurns).filter((x): x is number => typeof x === "number");
  const cacheRows = rows.filter((r) => typeof r.cacheReadTokens === "number");
  const frameLines = rows.filter((r) => r.turnType === "build" && typeof r.frameLines === "number").map((r) => r.frameLines!);

  const models: Record<string, number> = {};
  for (const r of rows) if (r.model) models[r.model] = (models[r.model] ?? 0) + 1;

  return {
    turns,
    okRate: turns ? rows.filter((r) => r.ok).length / turns : 0,
    byType: {
      build: rows.filter((r) => r.turnType === "build").length,
      edit: rows.filter((r) => r.turnType === "edit").length,
      none: rows.filter((r) => r.turnType === "none").length,
    },
    durationMs: { p50: pct(durations, 0.5), p90: pct(durations, 0.9), max: durations[durations.length - 1] ?? 0, n: durations.length },
    ttftMs: { p50: pct(ttfts, 0.5), p90: pct(ttfts, 0.9), max: ttfts[ttfts.length - 1] ?? 0, n: ttfts.length },
    avgNumTurns: numTurnsVals.length ? numTurnsVals.reduce((a, b) => a + b, 0) / numTurnsVals.length : null,
    cacheHitRate: cacheRows.length ? cacheRows.filter((r) => (r.cacheReadTokens ?? 0) > 0).length / cacheRows.length : null,
    stallRate: turns ? rows.filter((r) => r.stalled).length / turns : 0,
    models,
    frameLinesMedian: median(frameLines),
    totalCostUsd: rows.reduce((a, r) => a + (r.costUsd ?? 0), 0),
  };
}
