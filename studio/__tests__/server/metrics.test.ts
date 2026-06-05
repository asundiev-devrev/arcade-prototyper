// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordTurnMetric, summarizeMetrics, type TurnMetric } from "../../server/metrics";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-metrics-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function row(over: Partial<TurnMetric>): TurnMetric {
  return {
    at: new Date().toISOString(),
    slug: "p",
    source: "claude",
    ok: true,
    turnType: "build",
    ...over,
  };
}

describe("generation metrics", () => {
  it("appends rows and computes a summary", async () => {
    await recordTurnMetric(row({ turnType: "build", durationMs: 10000, ttftMs: 5000, numTurns: 3, frameLines: 40, cacheReadTokens: 0, model: "sonnet", costUsd: 0.1 }));
    await recordTurnMetric(row({ turnType: "edit", durationMs: 20000, ttftMs: 8000, numTurns: 2, frameLines: 80, cacheReadTokens: 50000, model: "sonnet", costUsd: 0.2 }));
    await recordTurnMetric(row({ turnType: "none", ok: false, stalled: true, model: "opus" }));

    const s = await summarizeMetrics();
    expect(s.turns).toBe(3);
    expect(s.byType).toEqual({ build: 1, edit: 1, none: 1 });
    expect(s.okRate).toBeCloseTo(2 / 3, 5);
    expect(s.stallRate).toBeCloseTo(1 / 3, 5);
    // duration percentiles over the 2 rows that reported it
    expect(s.durationMs.n).toBe(2);
    expect(s.durationMs.max).toBe(20000);
    // cache hit rate: 1 of 2 cache-reporting rows had cache_read > 0
    expect(s.cacheHitRate).toBeCloseTo(0.5, 5);
    // model mix catches the opus user
    expect(s.models).toEqual({ sonnet: 2, opus: 1 });
    // median frame size on BUILD turns only (40); edit's 80 excluded
    expect(s.frameLinesMedian).toBe(40);
    expect(s.totalCostUsd).toBeCloseTo(0.3, 5);
  });

  it("returns an empty summary when no log exists", async () => {
    const s = await summarizeMetrics();
    expect(s.turns).toBe(0);
    expect(s.cacheHitRate).toBeNull();
    expect(s.frameLinesMedian).toBeNull();
  });

  it("tolerates a torn final line", async () => {
    await recordTurnMetric(row({ durationMs: 5000 }));
    fs.appendFileSync(path.join(tmp, "generation-metrics.jsonl"), '{"at":"2026-01-01","slug":"x",incomplete');
    const s = await summarizeMetrics();
    expect(s.turns).toBe(1); // torn line skipped, valid row counted
  });

  it("windows rows by sinceMs", async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await recordTurnMetric(row({ at: old, durationMs: 1 }));
    await recordTurnMetric(row({ durationMs: 2 })); // now
    const s = await summarizeMetrics(Date.now() - 24 * 60 * 60 * 1000);
    expect(s.turns).toBe(1); // only the recent row
  });
});
