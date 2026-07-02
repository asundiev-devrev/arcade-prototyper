// @vitest-environment node
//
// Unit test for the Figma digest-race budget. The middleware integration test
// cannot exercise this — its ingest mock resolves instantly, so Promise.race
// never touches the timer and no test ever waits 15s/65s. That is exactly how
// the earlier narration-only assertion shipped GREEN with the 45s→15s fix
// reverted (adversarial review, blocking finding). This pins the actual value.
import { describe, it, expect } from "vitest";
import {
  digestRaceBudgetMs,
  FAST_DIGEST_BUDGET_MS,
  HIFI_DIGEST_BUDGET_MS,
} from "../../../server/middleware/chat";

describe("digestRaceBudgetMs", () => {
  it("waits the fast budget on a non-hi-fi turn", () => {
    expect(digestRaceBudgetMs(false)).toBe(FAST_DIGEST_BUDGET_MS);
    expect(FAST_DIGEST_BUDGET_MS).toBe(15_000);
  });

  it("waits the hi-fi budget on a precise turn — long enough to clear the phase-1 ceiling", () => {
    // Phase-1 worst case ≈ getNode(30s) + concurrent vars+png(30s) = 60s
    // (two figmanage calls capped at DEFAULT_FIGMANAGE_TIMEOUT_MS=30s each).
    // The hi-fi budget MUST exceed that ceiling, or a cold/large file misses
    // the race exactly like the 15s budget did on the precisely-4 gate.
    expect(digestRaceBudgetMs(true)).toBe(HIFI_DIGEST_BUDGET_MS);
    expect(HIFI_DIGEST_BUDGET_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("hi-fi budget is strictly larger than the fast budget", () => {
    expect(digestRaceBudgetMs(true)).toBeGreaterThan(digestRaceBudgetMs(false));
  });
});
