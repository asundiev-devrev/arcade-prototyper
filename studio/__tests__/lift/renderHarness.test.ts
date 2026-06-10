// studio/__tests__/lift/renderHarness.test.ts
//
// Guards for the render_harness block added 2026-05-13. The harness is
// always emitted; conditional checks adapt to which conventions fired.

import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderXml } from "../../src/lift/render";
import { buildRenderHarness } from "../../src/lift/renderHarness";

function mk(src: string, slug = "f") {
  return buildManifest({
    projectSlug: "p",
    frameSlug: slug,
    frameAbsPath: "/f",
    frameSource: src,
    intentSummary: "",
  });
}

function harnessScaffold(slug = "f") {
  return buildRenderHarness(mk(`export default () => null;`, slug)).storyScaffold;
}

describe("buildRenderHarness", () => {
  it("always includes baseline checks (console clean, real border color, non-transparent backgrounds)", () => {
    const harness = buildRenderHarness(mk(`export default () => null;`));
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/console errors/i);
    expect(joined).toMatch(/borderColor/);
    expect(joined).toMatch(/backgroundColor/);
  });

  it("adds an inline-style-token check when hasInlineStyleTokens fires", () => {
    const harness = buildRenderHarness(
      mk(`<div style={{ color: 'var(--fg-neutral-subtle)' }}/>`),
    );
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/style_attribute_convention/i);
  });

  it("adds an overlay check when hasOverlay fires", () => {
    const harness = buildRenderHarness(
      mk(`<div className="fixed inset-0 bg-black/50"/>`),
    );
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/fixed inset-0/i);
  });

  it("adds an icon-consumption check when icon imports are present", () => {
    const harness = buildRenderHarness(
      mk(`import { MagnifyingGlass } from "arcade/components";`),
    );
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/ICON_TYPES/);
  });

  it("adds a close-but-not-identity check naming the affected components", () => {
    const harness = buildRenderHarness(
      mk(`import { Tabs } from "arcade/components";`),
    );
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/close-but-not-identity/);
    expect(joined).toMatch(/Tabs/);
  });

  it("derives targetPath from the frameSlug", () => {
    const harness = buildRenderHarness(mk(`export default () => null;`, "my-slug"));
    expect(harness.targetPath).toContain("my-slug.tsx");
  });

  it("baseline checks lead with grep-does-not-prove-paint", () => {
    // Regression guard: the live 01-chat-with-canvas lift verified "by grep"
    // and shipped a transparent bubble. The harness must explicitly forbid
    // grep-as-verification before any visual claim.
    const harness = buildRenderHarness(mk(`export default () => null;`));
    expect(harness.checks[0]).toMatch(/grep/i);
    expect(harness.checks[0]).toMatch(/getComputedStyle|computed style/i);
  });

  it("names a durable screenshot path beside the lift file and keeps it through cleanup", () => {
    // Regression guard: a lift deleted its render as "verification scratch"
    // and left the human reviewer with nothing to look at. The screenshot is
    // a DURABLE output (kept beside the lift); the cleanup step keeps it and
    // deletes only the scratch story.
    const harness = buildRenderHarness(mk(`export default () => null;`, "chat-with-canvas"));
    expect(harness.screenshotPath).toBe("tmp/lift/chat-with-canvas.render.png");
    expect(harness.storyScaffold).toMatch(/SAVE A SCREENSHOT/);
    expect(harness.storyScaffold).toMatch(/durable output, NOT scratch/i);
    expect(harness.storyScaffold).toMatch(/KEEP the lift file AND the screenshot/);
  });

  it("emits a concrete story scaffold with launch command and predicted story id", () => {
    const harness = buildRenderHarness(mk(`export default () => null;`, "chat-with-canvas"));
    // The scaffold must remove the excuses: it names the globbed dir, the
    // launch command, and a derivable iframe URL.
    expect(harness.storyScaffold).toMatch(/__lift_validation/);
    expect(harness.storyScaffold).toMatch(/start:storybook/);
    expect(harness.storyScaffold).toMatch(/lift-validation-chatwithcanvas--default/);
    // iframeUrl is now concrete (4400), not a placeholder.
    expect(harness.iframeUrl).toMatch(/localhost:4400/);
    expect(harness.iframeUrl).toMatch(/lift-validation-chatwithcanvas--default/);
  });

  it("story scaffold declares the render story is in-scope and prescribes cleanup", () => {
    // Regression guard: a live lift agent skipped the render because the
    // kickoff said "only write the lift file" and the scaffold told it to
    // write a story elsewhere — it read that as a scope conflict and flagged
    // a gap instead of rendering. The scaffold must resolve the conflict
    // explicitly (story = in-scope verification scratch) and have the agent
    // delete it after.
    expect(harnessScaffold()).toMatch(/in-scope|IN-SCOPE/);
    expect(harnessScaffold()).toMatch(/not a codebase|NOT a codebase|codebase modification/i);
    expect(harnessScaffold()).toMatch(/delete the scratch|Clean up/i);
  });

  it("prefixes a numeric-leading slug so the component name is a valid identifier", () => {
    const harness = buildRenderHarness(mk(`export default () => null;`, "01-chat"));
    // PascalCase("01-chat") = "01Chat" — not a valid JS identifier; must be
    // prefixed. The predicted story id reflects the safe name.
    expect(harness.storyScaffold).toMatch(/Frame01Chat/);
    expect(harness.iframeUrl).toMatch(/frame01chat--default/);
  });

  it("adds an app-scoped-token check when the frame imports ChatBubble", () => {
    const harness = buildRenderHarness(
      mk(`import { ChatBubble } from "arcade/components";`),
    );
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/user-bubble-primary/);
    expect(joined).toMatch(/bg-menu-selected/);
  });

  it("backdrop note prescribes a non-white background to expose near-white borders", () => {
    const harness = buildRenderHarness(mk(`export default () => null;`));
    expect(harness.backdropNote).toMatch(/backdrop|background/i);
    expect(harness.backdropNote).toMatch(/hsl\(var\(--/);
  });
});

describe("render_harness XML emission", () => {
  it("emits a <render_harness> block on every manifest", () => {
    const xml = renderXml(mk(`export default () => null;`));
    expect(xml).toContain("<render_harness>");
    expect(xml).toContain("<target_path>");
    expect(xml).toContain("<iframe_url>");
    expect(xml).toContain("<backdrop_note>");
    expect(xml).toContain("<checks>");
    expect(xml).toContain("<check>");
  });

  it("emits a kept <screenshot_path> so the render survives for review", () => {
    const xml = renderXml(mk(`export default () => null;`, "my-frame"));
    expect(xml).toContain(`<screenshot_path keep="true">tmp/lift/my-frame.render.png</screenshot_path>`);
  });
});
