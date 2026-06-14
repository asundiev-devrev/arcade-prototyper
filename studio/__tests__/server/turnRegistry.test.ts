// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  startTurn,
  subscribe,
  getTurn,
  hasActiveTurn,
  __resetTurnRegistryForTests,
} from "../../server/turnRegistry";
import type { StudioEvent } from "../../src/lib/streamJson";

beforeEach(() => __resetTurnRegistryForTests());

describe("turn registry", () => {
  it("buffers events emitted by the runner and replays them to late subscribers", () => {
    const slug = "demo";
    startTurn(slug, {
      prompt: "hello",
      run: ({ emit, end }) => {
        emit({ kind: "narration", text: "thinking" });
        emit({ kind: "tool_call", tool: "Read", pretty: "Reading foo" });
        end({ ok: true });
      },
    });

    const events: StudioEvent[] = [];
    const sub = subscribe(slug, (ev) => events.push(ev), () => {});
    expect(sub).toBeDefined();
    // Late subscribers get replay only (turn has already ended).
    expect(sub!.replay.map((e) => e.kind)).toEqual(["narration", "tool_call", "end"]);
    expect(sub!.status).toBe("done");
  });

  it("fans live events out to active subscribers", () => {
    const slug = "live";
    let emitFn!: (ev: StudioEvent) => void;
    let endFn!: (r: { ok: boolean; error?: string }) => void;
    startTurn(slug, {
      prompt: "hi",
      run: ({ emit, end }) => {
        emitFn = emit;
        endFn = end;
      },
    });

    const received: StudioEvent[] = [];
    let terminated = false;
    const sub = subscribe(slug, (ev) => received.push(ev), () => { terminated = true; });
    expect(sub!.status).toBe("running");

    emitFn({ kind: "narration", text: "step 1" });
    emitFn({ kind: "tool_call", tool: "Write", pretty: "Writing file" });
    endFn({ ok: true });

    // Live subscribers see only events emitted after they subscribed, plus a
    // synthesized terminal on finalize.
    expect(received.map((e) => e.kind)).toEqual(["narration", "tool_call", "end"]);
    expect(terminated).toBe(true);
    expect(getTurn(slug)?.status).toBe("done");
  });

  it("synthesizes a terminal end event when the runner ends without one", () => {
    const slug = "abrupt";
    startTurn(slug, {
      prompt: "",
      run: ({ end }) => {
        end({ ok: false, error: "boom" });
      },
    });

    const sub = subscribe(slug, () => {}, () => {});
    const last = sub!.replay[sub!.replay.length - 1];
    expect(last.kind).toBe("end");
    expect(last).toMatchObject({ ok: false, error: "boom" });
  });

  it("supersedes a running turn when a new one starts for the same slug", () => {
    const slug = "race";
    startTurn(slug, { prompt: "first", run: () => {} });
    startTurn(slug, {
      prompt: "second",
      run: ({ end }) => end({ ok: true }),
    });
    const t = getTurn(slug);
    expect(t?.prompt).toBe("second");
    expect(t?.status).toBe("done");
  });

  it("isolates turns across slugs", () => {
    startTurn("a", { prompt: "a1", run: ({ end }) => end({ ok: true }) });
    startTurn("b", { prompt: "b1", run: ({ end }) => end({ ok: false, error: "x" }) });
    expect(getTurn("a")?.status).toBe("done");
    expect(getTurn("b")?.status).toBe("error");
  });
});

describe("hasActiveTurn", () => {
  beforeEach(() => __resetTurnRegistryForTests());

  it("is false when no turns exist", () => {
    expect(hasActiveTurn()).toBe(false);
  });

  it("is true while a turn is running", () => {
    startTurn("proj-a", { prompt: "x", run: () => { /* never ends */ } });
    expect(hasActiveTurn()).toBe(true);
  });

  it("is false after the only turn finishes", () => {
    startTurn("proj-a", {
      prompt: "x",
      run: ({ end }) => { end({ ok: true }); },
    });
    expect(hasActiveTurn()).toBe(false);
  });

  it("is true if ANY of several turns is running", () => {
    startTurn("proj-done", { prompt: "x", run: ({ end }) => end({ ok: true }) });
    startTurn("proj-live", { prompt: "y", run: () => { /* never ends */ } });
    expect(hasActiveTurn()).toBe(true);
  });
});
