import { describe, it, expect, vi } from "vitest";
import { resetPerTurn } from "../../src/hooks/useProjectFromHost";

describe("resetPerTurn — the turn-persistence crux", () => {
  it("clears per-turn refs but LEAVES digestByFrame (mount-time digest survives)", () => {
    const digest = new Map<string, unknown>([["01-frame", { elements: [], truncated: false }]]);
    const refs = {
      noOpCandidate: { current: "01-frame" as string | null },
      handledTurn: { current: "turn-1" as string | null },
      digestByFrame: { current: digest },
    };
    const clearBanners = vi.fn();
    resetPerTurn(refs, clearBanners);
    expect(refs.noOpCandidate.current).toBeNull();
    expect(refs.handledTurn.current).toBeNull();
    expect(clearBanners).toHaveBeenCalledOnce();
    // THE ASSERTION THAT MATTERS: the digest is still there for the no-edit turn.
    expect(refs.digestByFrame.current.get("01-frame")).toBeTruthy();
  });
});
