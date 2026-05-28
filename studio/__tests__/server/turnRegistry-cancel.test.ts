import { describe, it, expect, beforeEach } from "vitest";
import {
  startTurn,
  cancelTurn,
  getTurn,
  __resetTurnRegistryForTests,
} from "../../server/turnRegistry";

describe("turnRegistry cancellation", () => {
  beforeEach(() => {
    __resetTurnRegistryForTests();
  });

  it("cancelTurn flips a running turn to cancelled and aborts its signal", () => {
    let abortReason: unknown;
    const turn = startTurn("alpha", {
      prompt: "hi",
      run: ({ signal }) => {
        signal.addEventListener("abort", () => {
          abortReason = signal.reason;
        });
        // never call end — registry will finalize via cancelTurn
      },
    });
    expect(turn.status).toBe("running");

    const ok = cancelTurn("alpha");
    expect(ok).toBe(true);

    const after = getTurn("alpha");
    expect(after?.status).toBe("cancelled");
    expect(abortReason).toBeDefined();
  });

  it("cancelTurn returns false when no turn is running", () => {
    expect(cancelTurn("missing")).toBe(false);
  });

  it("cancelled turns emit a terminal end event with cancelled:true", () => {
    const events: any[] = [];
    startTurn("beta", {
      prompt: "hi",
      run: ({ emit }) => {
        emit({ kind: "narration", text: "starting" });
        // never call end — registry finalizes via cancelTurn below
      },
    });
    const turn = getTurn("beta")!;
    turn.subscribers.add((ev) => events.push(ev));

    cancelTurn("beta");
    const last = events[events.length - 1];
    expect(last.kind).toBe("end");
    expect(last.ok).toBe(false);
    expect(last.cancelled).toBe(true);
  });
});
