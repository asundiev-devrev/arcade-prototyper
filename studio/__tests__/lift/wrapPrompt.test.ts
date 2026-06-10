// studio/__tests__/lift/wrapPrompt.test.ts
//
// Guards for the clipboard payload produced by "Copy Lift Manifest"
// starting in 0.16.1. The tests are small on purpose — the prompt text
// itself is the product here; tests just make sure the substitutions
// happen and the manifest survives intact.

import { describe, it, expect } from "vitest";
import { wrapManifestWithPrompt } from "../../src/lift/wrapPrompt";

const SAMPLE_MANIFEST = `<lift_manifest schema_version="1" project="demo" frame="hello" shape="ad-hoc">
  <frame_path>/abs/path/hello/index.tsx</frame_path>
</lift_manifest>`;

describe("wrapManifestWithPrompt", () => {
  it("embeds the raw manifest inside a fenced xml block", () => {
    const out = wrapManifestWithPrompt({
      manifestXml: SAMPLE_MANIFEST,
      frameSlug: "hello",
    });
    expect(out).toContain("```xml");
    expect(out).toContain("```\n");
    expect(out).toContain(SAMPLE_MANIFEST);
  });

  it("names the frame slug in the target-file path so the agent has a default", () => {
    const out = wrapManifestWithPrompt({
      manifestXml: SAMPLE_MANIFEST,
      frameSlug: "01-skills-gallery",
    });
    expect(out).toContain("tmp/lift/01-skills-gallery.tsx");
  });

  it("tells the agent to read each top-level manifest convention before writing", () => {
    const out = wrapManifestWithPrompt({
      manifestXml: SAMPLE_MANIFEST,
      frameSlug: "hello",
    });
    // The four convention tags the manifest renderer emits.
    for (const tag of [
      "icon_convention",
      "chrome_convention",
      "overlay_convention",
      "default_mapping_convention",
    ]) {
      expect(out).toContain(tag);
    }
  });

  it("references frame_path so the agent reads the original source", () => {
    // Earlier drafts hard-coded a file path; the production version points
    // at the manifest's own <frame_path> tag instead. Regression guard.
    const out = wrapManifestWithPrompt({
      manifestXml: SAMPLE_MANIFEST,
      frameSlug: "hello",
    });
    expect(out).toContain("<frame_path>");
  });

  it("instructs a live render and forbids grep-as-verification", () => {
    // Regression guard: a live lift skipped the render_harness because the
    // prompt said "do NOT modify anything else" and never mentioned
    // rendering. The agent verified by grep — which the harness itself says
    // is invalid — and reported a gap. The prompt must (a) tell the agent to
    // render via the render_harness, and (b) explicitly reject grep.
    const out = wrapManifestWithPrompt({
      manifestXml: SAMPLE_MANIFEST,
      frameSlug: "hello",
    });
    expect(out).toContain("render_harness");
    expect(out).toMatch(/getComputedStyle|computed styles?/i);
    expect(out).toMatch(/grep/i);
  });

  it("carves the scratch validation story out of the no-other-changes rule", () => {
    // The "don't modify anything else" instruction must not read as
    // forbidding the in-scope verification scratch story — that conflict is
    // exactly what made the agent skip the render.
    const out = wrapManifestWithPrompt({
      manifestXml: SAMPLE_MANIFEST,
      frameSlug: "hello",
    });
    expect(out).toMatch(/in-scope|scratch story/i);
    expect(out).toMatch(/delete it|then delete|scratch \*story\*/i);
  });

  it("requires saving a durable screenshot and forbids deleting it", () => {
    // Regression guard: a lift treated the whole render as deletable scratch
    // and removed the screenshot, leaving the human reviewer nothing to look
    // at. The prompt must require saving to <screenshot_path> and keeping it.
    const out = wrapManifestWithPrompt({
      manifestXml: SAMPLE_MANIFEST,
      frameSlug: "hello",
    });
    expect(out).toMatch(/screenshot/i);
    expect(out).toMatch(/screenshot_path/);
    expect(out).toMatch(/do NOT delete it|durable output/i);
  });

  it("doesn't name a specific target codebase (devrev-web, etc.)", () => {
    // Shipping posture: the prompt works against any target repo. A beta
    // tester using Studio against a different codebase shouldn't get
    // devrev-web-specific instructions.
    const out = wrapManifestWithPrompt({
      manifestXml: SAMPLE_MANIFEST,
      frameSlug: "hello",
    });
    expect(out.toLowerCase()).not.toContain("devrev-web");
  });
});
