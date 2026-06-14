// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  detectHiFiIntent,
  buildHiFiDirective,
  shouldUseHiFi,
} from "../../../server/figma/fidelityDirective";

describe("detectHiFiIntent", () => {
  it("fires on explicit pixel-perfect / precise phrasing", () => {
    const yes = [
      "Build a pixel-perfect version of this screen",
      "implement the design I shared precisely",
      "match it exactly please",
      "I want an exact replica of the figma",
      "make this 1:1 with the mockup",
      "high-fidelity build of this frame",
      "faithfully reproduce the header",
    ];
    for (const p of yes) expect(detectHiFiIntent(p), p).toBe(true);
  });

  it("fires on 'dismiss your template and implement the design'", () => {
    // The exact shape of the SoR-nav prompts that produced the bad frames.
    const p =
      "Build an interactive prototype of this new version of the Nav. " +
      "It's different from the nav template you currently have, and that is " +
      "intentional, so, please, dismiss your template, and implement the " +
      "design I shared precisely.";
    expect(detectHiFiIntent(p)).toBe(true);
  });

  it("does NOT fire on ordinary fast-sketch prompts", () => {
    const no = [
      "Build me a dashboard from this figma",
      "Sketch a settings page",
      "make a chat screen inspired by this",
      "match the brand colors to our palette",
      "a quick prototype of the onboarding flow",
      "",
    ];
    for (const p of no) expect(detectHiFiIntent(p), p).toBe(false);
  });

  it("is robust to non-string input", () => {
    expect(detectHiFiIntent(undefined as unknown as string)).toBe(false);
    expect(detectHiFiIntent(null as unknown as string)).toBe(false);
  });
});

describe("shouldUseHiFi", () => {
  it("fires on explicit intent regardless of classification", () => {
    expect(shouldUseHiFi("implement this precisely", { classified: false, hasHighConfidenceComposite: false })).toBe(true);
    expect(shouldUseHiFi("pixel-perfect please", { classified: true, hasHighConfidenceComposite: true })).toBe(true);
  });

  it("auto-fires on a novel design: classified, but no high-confidence template match", () => {
    // The churn case: a designer who did NOT say "precisely" but pasted a
    // Figma with no matching template still wants the design built accurately.
    expect(shouldUseHiFi("build this nav from the figma", { classified: true, hasHighConfidenceComposite: false })).toBe(true);
  });

  it("does NOT auto-fire when a high-confidence template matched (iterate-on-existing path)", () => {
    expect(shouldUseHiFi("build this from the figma", { classified: true, hasHighConfidenceComposite: true })).toBe(false);
  });

  it("does NOT auto-fire before classification has run (avoids first-turn misfire)", () => {
    // Phase-2 classifier runs in the background; composites=[] on the first
    // turn means "not classified yet", NOT "no match". Must not fire then.
    expect(shouldUseHiFi("build this from the figma", { classified: false, hasHighConfidenceComposite: false })).toBe(false);
  });
});

describe("buildHiFiDirective", () => {
  const ctx = { fileKey: "ABC123", nodeId: "3532:40693", hasReferencePng: true };

  it("wraps the directive in the high_fidelity_mode tag", () => {
    const out = buildHiFiDirective(ctx);
    expect(out.startsWith("<high_fidelity_mode>")).toBe(true);
    expect(out.trimEnd().endsWith("</high_fidelity_mode>")).toBe(true);
  });

  it("names the real figmanage read with the exact file key + node id", () => {
    const out = buildHiFiDirective(ctx);
    expect(out).toContain("figmanage reading get-nodes --depth 4 ABC123 3532:40693");
  });

  it("tells the agent the summary is lossy and the PNG wins", () => {
    const out = buildHiFiDirective(ctx);
    expect(out).toMatch(/LOSSY/);
    expect(out).toMatch(/PNG wins/i);
    // Targets the specific wordmark-collapse failure.
    expect(out).toMatch(/WORDMARK/);
    expect(out).toMatch(/NEVER substitute a single generic icon glyph/i);
  });

  it("instructs a self-review pass (overriding the no-verify rule)", () => {
    const out = buildHiFiDirective(ctx);
    expect(out).toMatch(/BEFORE YOU FINISH/);
    expect(out).toMatch(/same number of rows/i);
  });

  it("when no reference PNG is attached, tells the agent to export one itself", () => {
    const out = buildHiFiDirective({ ...ctx, hasReferencePng: false });
    expect(out).toContain("figmanage export nodes --format png --scale 2 --json ABC123 3532:40693");
  });

  it("when a reference PNG IS attached, points at the attached PNG (no export step)", () => {
    const out = buildHiFiDirective(ctx);
    expect(out).toContain("attached high-resolution PNG");
    expect(out).not.toContain("export nodes --format png");
  });

  it("clarifies that 'dismiss the template' means drop the macro layout, not hand-roll atoms", () => {
    const out = buildHiFiDirective(ctx);
    // Must distinguish the MACRO layout composite (NavSidebar) from the LEAF
    // kit components that still apply — the SoR-nav agent read "dismiss
    // template" as "rebuild every atom from <div>" and invented icons.
    expect(out).toMatch(/macro layout/i);
    expect(out).toMatch(/leaf/i);
    expect(out).toMatch(/hand-roll/i);
  });

  it("tells the agent to use the bbox geometry and component identity in the summary", () => {
    const out = buildHiFiDirective(ctx);
    // The compacted tree now carries @[x,y,w,h] geometry and instance
    // component names+props — the directive must point the agent at them.
    expect(out).toMatch(/@\[/);
    expect(out).toMatch(/component/i);
  });
});
