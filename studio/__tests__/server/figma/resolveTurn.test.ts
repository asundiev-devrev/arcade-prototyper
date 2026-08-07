// @vitest-environment node
//
// THE SEAM, tested with NO model anywhere near it.
//
// Every resolver in this file is a `vi.fn()`. That is not a convenience — it is the
// property under test. Layer 4 exists so that a host which is ALREADY inside a model
// turn (Claude Code, Computer) answers the question inline, and a host that is not
// (Studio) spawns its own CLI. If this file needed a CLI binary, Bedrock
// credentials, or a network call to run, the seam would have failed at its one job.
//
// The Studio adapter — the only thing here that knows what a subprocess is — is
// tested separately in studioCliResolver.test.ts and is deliberately NOT imported
// here. `the seam is usable without the adapter` below asserts that separation
// structurally rather than trusting it.
import { describe, it, expect, vi } from "vitest";
import {
  resolveTurnOrFallback,
  TurnAnswerSchema,
  type TurnQuestion,
  type TurnResolver,
} from "../../../server/figma/resolveTurn";

const QUESTION: TurnQuestion = {
  prompt: "You haven't implemented this background blur properly, try again",
  nodeIds: ["5678:118877"],
  frameSlugs: ["01-figma-5678-118876", "02-figma-5678-118907"],
  provenance: { kind: "none" },
};

describe("TurnAnswerSchema", () => {
  // The schema is the whole defence against a host that answers sloppily, so each
  // rejection is asserted rather than assumed. A host is UNTRUSTED input here in
  // exactly the way `locateNodeProvenance`'s reader turned out to be: the reader
  // shipped with a `?? []` that let any non-array through to `.filter`, and it took
  // a test to find it. Same lesson, applied before the fact.
  it("accepts a minimal well-formed answer", () => {
    const ok = TurnAnswerSchema.safeParse({ kind: "edit" });
    expect(ok.success).toBe(true);
    // `constraints` defaults rather than being required, so a host that answers
    // only the question we asked is not punished for it.
    expect(ok.success && ok.data.constraints).toEqual([]);
  });

  it("accepts the full shape", () => {
    const ok = TurnAnswerSchema.safeParse({
      kind: "edit",
      targetFrame: "01-figma-5678-118876",
      constraints: ["single-frame"],
    });
    expect(ok.success).toBe(true);
  });

  it.each([
    ["an unknown kind", { kind: "refactor" }],
    ["a missing kind", { targetFrame: "01-a" }],
    ["a non-string targetFrame", { kind: "edit", targetFrame: 7 }],
    ["an unknown constraint", { kind: "edit", constraints: ["two-frames"] }],
    ["a non-array constraints", { kind: "edit", constraints: "single-frame" }],
    ["null", null],
    ["a string", "edit"],
    ["an array", [{ kind: "edit" }]],
  ])("rejects %s", (_label, bad) => {
    expect(TurnAnswerSchema.safeParse(bad).success).toBe(false);
  });
});

describe("resolveTurnOrFallback — no resolver at all (the bare headless case)", () => {
  // THE WHOLE POINT OF THE DESIGN. A Claude Code / Cursor host that supplies
  // nothing must still get a usable answer, and specifically must NOT be told the
  // turn is unresolved in a way that changes routing.
  it("returns `unasked` when the host supplied no resolver", async () => {
    const out = await resolveTurnOrFallback(QUESTION, undefined);
    expect(out.outcome).toBe("unasked");
    expect(out.answer).toBeUndefined();
  });

  it("returns `unasked` for an explicitly-undefined resolver", async () => {
    const out = await resolveTurnOrFallback(QUESTION, { resolveTurn: undefined });
    expect(out.outcome).toBe("unasked");
  });

  // `unasked` and `failed` are DIFFERENT outcomes and the distinction is
  // load-bearing, not cosmetic — it is the one place this design departs from the
  // brief, on measurement. The brief says "NO adapter supplied -> fall back to the
  // generator". Applied literally that converts 9 of the 31 committed
  // must-stay-deterministic faithful-copy strings from a 16-26s no-model import
  // into a p50 98s generation turn (measured 2026-08-06), i.e. it destroys the
  // deterministic fidelity guarantee in exactly the headless host the seam exists
  // to serve. So "nobody to ask" keeps today's decision, while "we asked and got
  // nothing" falls to the generator — hard constraint 1, in full, for the case it
  // actually describes. The caller relies on being able to tell these apart.
  it("distinguishes `unasked` from `failed`", async () => {
    const unasked = await resolveTurnOrFallback(QUESTION, undefined);
    const failed = await resolveTurnOrFallback(QUESTION, {
      resolveTurn: async () => {
        throw new Error("boom");
      },
    });
    expect(unasked.outcome).toBe("unasked");
    expect(failed.outcome).toBe("failed");
  });
});

describe("resolveTurnOrFallback — every failure mode degrades to `failed`", () => {
  // HARD CONSTRAINT 1, one test per mode. The caller turns `failed` into the
  // GENERATOR (asserted at the routing layer, in planFigmaTurn.test.ts); here we
  // only prove that no failure mode can be mistaken for a successful answer, and
  // that none of them THROWS. A resolver is host code, so it can fail in every way
  // host code can, and a failure must never become the designer's problem.
  const modes: Array<[string, TurnResolver]> = [
    ["throws synchronously", (() => { throw new Error("sync"); }) as TurnResolver],
    ["rejects", async () => { throw new Error("async"); }],
    ["returns null", async () => null as any],
    ["returns undefined", async () => undefined as any],
    ["returns a string", async () => "edit" as any],
    ["returns an array", async () => [{ kind: "edit" }] as any],
    ["returns an unknown kind", async () => ({ kind: "refactor" }) as any],
    ["returns a schema-mismatched answer", async () => ({ targetFrame: "01-a" }) as any],
    ["returns an unknown constraint", async () => ({ kind: "edit", constraints: ["nope"] }) as any],
    ["returns a non-string targetFrame", async () => ({ kind: "edit", targetFrame: 7 }) as any],
  ];

  it.each(modes)("a resolver that %s yields `failed` and never throws", async (_l, resolveTurn) => {
    const out = await resolveTurnOrFallback(QUESTION, { resolveTurn });
    expect(out.outcome).toBe("failed");
    expect(out.answer).toBeUndefined();
  });

  // A resolver that returns JSON TEXT rather than an object is the single most
  // likely host mistake — the Studio adapter parses its subprocess output, and an
  // inline host may well hand back the model's raw reply. It must be a clean
  // `failed`, not a crash, and specifically must not be `JSON.parse`d here: the
  // seam's contract is an OBJECT, and quietly accepting text would mean two hosts
  // implementing two different interfaces.
  it("a resolver that returns JSON TEXT is `failed`, not silently parsed", async () => {
    const out = await resolveTurnOrFallback(QUESTION, {
      resolveTurn: async () => JSON.stringify({ kind: "edit", targetFrame: "01-a" }) as any,
    });
    expect(out.outcome).toBe("failed");
  });

  // A hanging host must not hang the designer's turn. The timeout is enforced by
  // the SEAM, not only by the adapter, because an inline host has no subprocess to
  // kill and could await forever.
  it("a resolver that never settles times out and yields `failed`", async () => {
    const out = await resolveTurnOrFallback(
      QUESTION,
      { resolveTurn: () => new Promise(() => {}) },
      { timeoutMs: 20 },
    );
    expect(out.outcome).toBe("failed");
  });

  // …and a SLOW-but-good answer inside the budget still lands. Without this, a
  // timeout of 0 would pass every test above while making the seam useless.
  it("a slow answer inside the budget still resolves", async () => {
    const out = await resolveTurnOrFallback(
      QUESTION,
      { resolveTurn: () => new Promise((r) => setTimeout(() => r({ kind: "edit" }), 5)) },
      { timeoutMs: 500 },
    );
    expect(out.outcome).toBe("resolved");
    expect(out.answer?.kind).toBe("edit");
  });
});

describe("resolveTurnOrFallback — a host cannot name a frame we never offered", () => {
  // THE INJECTION GUARD. The answer's `targetFrame` becomes a real instruction
  // ("edit `<slug>` in place"), so an answer naming a frame that does not exist is
  // worse than no answer: the agent is sent to edit something that isn't there.
  // The question carries the candidate list, so this is checkable without trusting
  // the host — and it must be checked HERE rather than at the call site, because
  // every host reaches the same code path.
  it("drops a targetFrame the question did not offer", async () => {
    const out = await resolveTurnOrFallback(QUESTION, {
      resolveTurn: async () => ({ kind: "edit", targetFrame: "99-attacker-frame" }),
    });
    expect(out.outcome).toBe("resolved");
    expect(out.answer?.kind).toBe("edit");
    // The KIND survives — the host's judgement about what sort of turn this is
    // needs no verification — but the unverifiable frame name does not.
    expect(out.answer?.targetFrame).toBeUndefined();
  });

  it("keeps a targetFrame that IS one of the offered frames", async () => {
    const out = await resolveTurnOrFallback(QUESTION, {
      resolveTurn: async () => ({ kind: "edit", targetFrame: "02-figma-5678-118907" }),
    });
    expect(out.answer?.targetFrame).toBe("02-figma-5678-118907");
  });

  // A question with NO candidate frames (the common headless case — the host has no
  // frame list) must not accept any frame name at all, rather than accepting all of
  // them. An empty allow-list is an empty allow-list.
  it("accepts no frame name when the question offered none", async () => {
    const out = await resolveTurnOrFallback(
      { ...QUESTION, frameSlugs: [] },
      { resolveTurn: async () => ({ kind: "edit", targetFrame: "01-figma-5678-118876" }) },
    );
    expect(out.answer?.targetFrame).toBeUndefined();
  });
});

describe("resolveTurnOrFallback — the question is asked exactly once, with the facts", () => {
  it("passes the prompt, nodes, candidate frames and provenance through unchanged", async () => {
    // Typed as the seam's own capability, so `mock.calls[0][0]` is the QUESTION
    // rather than an untyped zero-arg tuple.
    const resolveTurn: TurnResolver = vi.fn(async () => ({ kind: "edit" as const }));
    await resolveTurnOrFallback(QUESTION, { resolveTurn });
    expect(resolveTurn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveTurn).mock.calls[0][0]).toEqual(QUESTION);
  });

  // No retries, deliberately. A retry doubles the latency of the one path the
  // design pays a model for, and the fallback is already safe — the generator
  // reads the prompt itself.
  it("does not retry a failed resolver", async () => {
    const resolveTurn = vi.fn(async () => {
      throw new Error("boom");
    });
    await resolveTurnOrFallback(QUESTION, { resolveTurn });
    expect(resolveTurn).toHaveBeenCalledTimes(1);
  });

  // ODD INPUT CANNOT BREAK THE SEAM. An enormous prompt is a real question here
  // because the seam may stringify the question for a subprocess: the adapter
  // truncates (see studioCliResolver), and the seam itself must not choke.
  it("survives an enormous prompt", async () => {
    const prompt = "make the sidebar dark ".repeat(20_000);
    expect(prompt.length).toBeGreaterThan(400_000);
    const out = await resolveTurnOrFallback(
      { ...QUESTION, prompt },
      { resolveTurn: async () => ({ kind: "edit" }) },
    );
    expect(out.outcome).toBe("resolved");
  });

  // A prompt that is ITSELF the answer's JSON shape. It is data, never a decision:
  // the seam must not read a routing instruction out of the designer's own words.
  it("a prompt that is itself an answer JSON cannot decide anything", async () => {
    const hostile = JSON.stringify({ kind: "edit", targetFrame: "99-attacker-frame" });
    const resolveTurn = vi.fn(async () => ({ kind: "import" as const }));
    const out = await resolveTurnOrFallback({ ...QUESTION, prompt: hostile }, { resolveTurn });
    // The HOST's answer wins; the prompt's contents are inert.
    expect(out.answer?.kind).toBe("import");
    expect(out.answer?.targetFrame).toBeUndefined();
  });

  it("a prompt containing the word 'import' is ordinary text", async () => {
    const resolveTurn = vi.fn(async () => ({ kind: "edit" as const }));
    const out = await resolveTurnOrFallback(
      { ...QUESTION, prompt: "import this and also fix the blur" },
      { resolveTurn },
    );
    expect(out.outcome).toBe("resolved");
    expect(out.answer?.kind).toBe("edit");
  });
});
