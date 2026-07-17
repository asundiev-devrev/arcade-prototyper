import { describe, it, expect } from "vitest";
import { isVisualNoOp, observeFingerprint, type FpTracker } from "../../src/components/viewport/visualNoOp";

describe("isVisualNoOp", () => {
  it("true when probe equals baseline", () => {
    expect(isVisualNoOp("abc123", "abc123")).toBe(true);
  });
  it("false when they differ", () => {
    expect(isVisualNoOp("abc123", "def456")).toBe(false);
  });
  it("false when baseline is null (first generation)", () => {
    expect(isVisualNoOp("abc123", null)).toBe(false);
    expect(isVisualNoOp("abc123", undefined)).toBe(false);
  });
  it("false when probe is missing", () => {
    expect(isVisualNoOp(null, "abc123")).toBe(false);
  });
});

describe("observeFingerprint (nonce-keyed — ordering-immune, self-poison-proof)", () => {
  it("first fingerprint (no baseline) is captured, not compared", () => {
    const t: FpTracker = { baseline: null };
    expect(observeFingerprint(t, "base1", "")).toBe("captured");
    expect(t.baseline).toEqual({ fp: "base1", nonce: "" });
  });

  it("same-nonce fingerprint just refreshes the baseline (never a self-compare)", () => {
    const t: FpTracker = { baseline: { fp: "base1", nonce: "" } };
    // A second fingerprint for the SAME render (e.g. re-measure) — refresh, no compare.
    expect(observeFingerprint(t, "base1b", "")).toBe("captured");
    expect(t.baseline).toEqual({ fp: "base1b", nonce: "" });
  });

  it("a NEW-nonce fingerprint equal to baseline → no-op, then promotes (nonce advances)", () => {
    const t: FpTracker = { baseline: { fp: "base1", nonce: "0" } };
    expect(observeFingerprint(t, "base1", "1")).toBe("no-op");
    // promoted so the NEXT edit compares against this render
    expect(t.baseline).toEqual({ fp: "base1", nonce: "1" });
  });

  it("a NEW-nonce fingerprint that DIFFERS → changed, then promotes", () => {
    const t: FpTracker = { baseline: { fp: "base1", nonce: "0" } };
    expect(observeFingerprint(t, "moved2", "1")).toBe("changed");
    expect(t.baseline).toEqual({ fp: "moved2", nonce: "1" });
  });

  it("does NOT self-poison: an edit that truly changed pixels never reports no-op even if its fingerprint arrives after editCycle bookkeeping cleared", () => {
    // The whole point: no editCycleActive read. Ordering can't break it.
    const t: FpTracker = { baseline: { fp: "A", nonce: "0" } };
    expect(observeFingerprint(t, "B", "1")).toBe("changed");
    // subsequent identical render on nonce 2 vs the now-B baseline
    expect(observeFingerprint(t, "B", "2")).toBe("no-op");
  });
});
