// @vitest-environment node
//
// The plan→words translation, tested in the BRAIN, with no middleware anywhere
// near it. That separation is the point of the module: before it existed the
// translation lived in server/middleware/chat.ts (61-module import closure,
// reaching paths.ts / claudeBin.ts / awsPreflight.ts), so a Claude Code host got a
// correct routing plan for corpus #30 and had nowhere to act on it — the live
// 2026-08-06 failure was fixed inside the .dmg only, which is the one host the
// designers do not use.
import { describe, it, expect } from "vitest";
import { buildTurnDirectives, shouldSuppressWholeFrame } from "../../../server/figma/turnDirectives";
import { planFigmaTurn, type FigmaTurnPlan } from "../../../server/figma/turnRouting";
import { shouldGenerateFromFigma } from "../../../server/figma/generationIntent";
import { detectInteractionIntent, extractFigmaUrls } from "../../../src/lib/figmaUrl";
import { parseFigmaUrl } from "../../../server/figma/figmaNodeUrl";
import { detectHiFiIntent } from "../../../server/figma/fidelityDirective";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const corpus = require("../../fixtures/designer-prompts.json") as {
  prompts: Array<{ i: number; isCorrection: boolean; text: string }>;
};
const P = (i: number) => corpus.prompts[i].text;

function inputsFor(prompt: string) {
  const urls = extractFigmaUrls(prompt);
  return {
    hasFigmaNode: urls.length > 0,
    wantsGeneration: urls.length > 0 ? shouldGenerateFromFigma(prompt) : false,
    hasInteractionIntent: detectInteractionIntent(prompt),
    figmaUrlCount: urls.length,
    prompt,
    nodeIds: urls
      .map((u) => parseFigmaUrl(u)?.nodeId)
      .filter((n): n is string => Boolean(n)),
  };
}

const plan = (over: Partial<FigmaTurnPlan> = {}): FigmaTurnPlan => ({
  kind: "claude",
  decidedBy: "constraints",
  constraints: [],
  ...over,
});

describe("buildTurnDirectives", () => {
  it("states the second design is an in-frame STATE, forbids a second frame dir, forbids FrameLink", () => {
    const [d, ...rest] = buildTurnDirectives(plan({ constraints: ["single-frame"] }));
    expect(rest).toEqual([]);
    // The three things the task asks the directive to do, asserted separately so a
    // future rewrite that drops one fails on that one.
    expect(d).toContain("useState + conditional render");
    expect(d).toContain("Do NOT create a new frame directory");
    expect(d).toContain("Do NOT use <FrameLink> on this turn");
    // And it must OVERRIDE rather than merely disagree with CLAUDE.md — the
    // template's own flow-splitting rules are what contradicted the designer.
    expect(d).toContain("This overrides every other");
    expect(d).toContain("<single_frame_constraint>");
  });

  it("names the target frame when provenance identified exactly one", () => {
    const [d] = buildTurnDirectives(
      plan({ decidedBy: "provenance", targetFrame: "01-figma-5678-118876" }),
    );
    expect(d).toContain("<target_frame>");
    expect(d).toContain("`01-figma-5678-118876`");
    expect(d).toContain("EDITS the existing frame");
    expect(d).toContain("Do NOT create a new frame directory");
  });

  it("hands over CANDIDATES rather than guessing when provenance was ambiguous", () => {
    // Naming the WRONG frame is worse than naming none: the generator edits it
    // without hesitating and the designer's next turn is a second correction about
    // a third frame. So the agent — which can read the prompt — picks.
    const [d] = buildTurnDirectives(
      plan({ decidedBy: "provenance", frameCandidates: ["01-a", "02-b"] }),
    );
    expect(d).toContain("`01-a`, `02-b`");
    expect(d).toContain("more than one existing frame");
    expect(d).toContain("do not guess and rebuild");
    // It must NOT claim to know which one.
    expect(d).not.toContain("EDITS the existing frame `01-a`");
  });

  it("orders the constraint LAST, after the target frame", () => {
    // The constraint opens with "This overrides every other instruction about
    // frames", so it has to be the last thing the model reads before it starts.
    const out = buildTurnDirectives(
      plan({ targetFrame: "01-x", constraints: ["single-frame"] }),
    );
    expect(out.length).toBe(2);
    expect(out[0]).toContain("<target_frame>");
    expect(out[1]).toContain("<single_frame_constraint>");
  });

  it("returns [] for a plan with nothing to say — the byte-identical guarantee", () => {
    expect(buildTurnDirectives(plan())).toEqual([]);
    expect(buildTurnDirectives(plan({ decidedBy: "legacy-intent" }))).toEqual([]);
  });

  it("returns [] for an ABSENT plan (corrective re-runs pass none)", () => {
    // visual-noop / render-verify re-runs and the wire branch's inner wiring pass
    // all call runClaudeBranch with no plan. They must be unchanged.
    expect(buildTurnDirectives(undefined)).toEqual([]);
    expect(buildTurnDirectives(null)).toEqual([]);
  });

  it("returns [] for a kit-emit plan — the importer runs NO model and cannot read a directive", () => {
    expect(buildTurnDirectives(plan({ kind: "kit-emit", decidedBy: "default" }))).toEqual([]);
    // Defensive: even if a future edit let a constraint reach step 8 (the cascade
    // forbids it today), there is still nothing to hand a subprocess-free branch.
    expect(
      buildTurnDirectives(plan({ kind: "kit-emit", constraints: ["single-frame"] })),
    ).toEqual([]);
  });

  it("returns [] for a WIRE plan carrying single-frame — the branch satisfies it structurally", () => {
    // Checked against the branch itself rather than assumed: runFigmaWireBranch
    // imports URL#2 into the SAME frame dir as a sibling Overlay.tsx
    // (chat.ts entryFileName), so it produces ONE frame, and buildWirePrompt
    // already says "Do NOT create a new frame. Do NOT move the overlay into its
    // own frame." A directive forbidding a second frame here would contradict the
    // two-file structure the wiring pass depends on.
    expect(buildTurnDirectives(plan({ kind: "wire", constraints: ["single-frame"] }))).toEqual([]);
  });
});

describe("shouldSuppressWholeFrame", () => {
  // buildHiFiDirective says "each section has the SAME number of rows, same order,
  // as the PNG" — a description of building a fresh FULL frame. On a turn whose
  // referenced design is a second STATE of an existing frame, that instruction
  // actively causes the bug being fixed. And it fires with NO hi-fi wording,
  // because shouldUseHiFi's novel-design upgrade turns it on whenever the
  // classifier matched no high-confidence template.
  it("suppresses on a single-frame constraint", () => {
    expect(
      shouldSuppressWholeFrame(plan({ constraints: ["single-frame"] }), { explicitHiFi: false }),
    ).toBe(true);
  });

  it("suppresses on a provenance-located edit (named frame or candidates)", () => {
    expect(shouldSuppressWholeFrame(plan({ targetFrame: "01-x" }), { explicitHiFi: false })).toBe(true);
    expect(
      shouldSuppressWholeFrame(plan({ frameCandidates: ["01-x", "02-y"] }), { explicitHiFi: false }),
    ).toBe(true);
  });

  it("does NOT suppress an ordinary build turn", () => {
    expect(shouldSuppressWholeFrame(plan({ decidedBy: "legacy-intent" }), { explicitHiFi: false })).toBe(false);
    expect(shouldSuppressWholeFrame(undefined, { explicitHiFi: false })).toBe(false);
    expect(shouldSuppressWholeFrame(plan({ kind: "kit-emit" }), { explicitHiFi: false })).toBe(false);
  });

  it("does NOT suppress when the designer EXPLICITLY asked for precision", () => {
    // "Implement this precisely, but keep it in the same frame" must keep the
    // <high_fidelity_mode> block it gets today AND gain the constraint. The naive
    // widening loses BOTH — worse than before the fix (spec review, revision 4).
    // The frame question is settled by the constraint directive, which is appended
    // last and opens by overriding everything else about frames.
    expect(
      shouldSuppressWholeFrame(plan({ constraints: ["single-frame"] }), { explicitHiFi: true }),
    ).toBe(false);
  });

  it("the carve-out fires on ZERO of the prompts this design fixes", async () => {
    // The measurement that makes the carve-out safe rather than a hole: hi-fi
    // wording is absent from every prompt whose frame handling we are correcting,
    // so suppression is total for all of them.
    for (const i of [1, 2, 30, 39]) {
      expect(detectHiFiIntent(P(i)), `#${i}`).toBe(false);
    }
  });
});

describe("end to end from the cascade, with no host capability at all", () => {
  // The whole chain a foreign host runs: prompt → plan → directives. No reader, no
  // Studio filesystem, no middleware.
  it("#30's shouting form produces the single-frame directive", async () => {
    const out = buildTurnDirectives(await planFigmaTurn(inputsFor(P(30))));
    expect(out.length).toBe(1);
    expect(out[0]).toContain("<single_frame_constraint>");
  });

  it("#2 — the wording the template contradicted — produces it too", async () => {
    const out = buildTurnDirectives(await planFigmaTurn(inputsFor(P(2))));
    expect(out.length).toBe(1);
    expect(out[0]).toContain("<single_frame_constraint>");
  });

  it("a bare import produces NOTHING (the fast path stays a fast path)", async () => {
    for (const i of [0, 37, 45, 53]) {
      expect(buildTurnDirectives(await planFigmaTurn(inputsFor(P(i)))), `#${i}`).toEqual([]);
    }
  });

  it("a prompt with NO Figma URL produces nothing — hard constraint 2", async () => {
    // The exact bug that already shipped: a gate written as `kind === "claude" &&
    // …` also fires on ordinary prompts, and a designer typing this was told "Do
    // NOT create a new frame directory".
    const p = await planFigmaTurn(inputsFor("New screen: an error state with a Try again button"));
    expect(p.kind).toBe("claude");
    expect(p.decidedBy).toBe("no-node");
    expect(buildTurnDirectives(p)).toEqual([]);
    // And the adversarial version: constraint WORDING but no URL.
    const q = await planFigmaTurn(
      inputsFor("Add the confirmation step, keep everything on a single frame"),
    );
    expect(q.decidedBy).toBe("no-node");
    expect(buildTurnDirectives(q)).toEqual([]);
  });

  it("#1 with a frame handed over the way a Claude-Code host would, names the frame", async () => {
    const p = await planFigmaTurn(inputsFor(P(1)), {
      readFrames: async () => [
        { slug: "01-figma-5678-118876", source: '<div data-figma-id="5678:118877"/>' },
      ],
    });
    const out = buildTurnDirectives(p);
    expect(out.length).toBe(1);
    expect(out[0]).toContain("`01-figma-5678-118876`");
    expect(shouldSuppressWholeFrame(p, { explicitHiFi: detectHiFiIntent(P(1)) })).toBe(true);
  });
});
