// @vitest-environment node
//
// THE TEMPLATE CONTRADICTED THE DESIGNER, and that is why these edits exist.
//
// Before the 2026-08-06 session's fix, CLAUDE.md.tpl told the generator (a) to
// create frames for new steps "without asking — the user has committed to multiple
// frames", and (b) that "pressing Save goes to the confirmation" is a cross-frame
// <FrameLink> signal. Corpus #2 is *"When I click on Save, I want you to animate
// the transition to this screen … IMPORTANT: don't separate these screens onto
// multiple frames"* — it matches that signal pattern almost word for word, and the
// generator split it into two frames, which is the one thing the prompt forbade.
//
// Routing alone cannot fix that: the prompt-region directive
// (<single_frame_constraint>) is the primary mechanism, but the template is what
// the generator reads on EVERY turn, and it was actively arguing the other side.
// Corpus #39 has no Figma URL at all, so the routing cascade never sees its
// constraint — for #39 these template edits are the ONLY fix.
//
// Cheap guard, in the shape of the existing claude-md-*.test.ts files: read the
// template, assert the marker phrases. A future template rewrite that drops any of
// the three fails here rather than in a designer's session.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createProject } from "../../server/projects";

const tpl = fs.readFileSync(path.resolve(__dirname, "../../templates/CLAUDE.md.tpl"), "utf8");

describe("CLAUDE.md.tpl single-frame override", () => {
  it("states that an explicit in-frame instruction OVERRIDES the FrameLink signals", () => {
    expect(tpl).toMatch(/An explicit in-frame instruction OVERRIDES every signal below/);
    // It must land BEFORE the signal list it overrides — the generator is entitled
    // to follow whichever rule it reads last, which is the whole failure mode.
    const override = tpl.indexOf("An explicit in-frame instruction OVERRIDES");
    const signals = tpl.indexOf("**Signal patterns to watch for in the prompt:**");
    expect(override).toBeGreaterThan(-1);
    expect(signals).toBeGreaterThan(override);
  });

  it("names the real phrasings designers used, so recognition does not depend on paraphrase", () => {
    // Verbatim from the corpus: #2, #30, #39. A generator that only recognises our
    // paraphrase will miss the sentence the designer actually typed.
    expect(tpl).toContain("don't separate these screens");
    expect(tpl).toContain("within this single frame");
    expect(tpl).toContain("DON'T IMPLEMENT THIS AS A SEPARATE FRAME");
    expect(tpl).toContain("as a tab in the main frame");
  });

  it("says what to build INSTEAD — an in-frame state, not just a prohibition", () => {
    // A rule that only forbids leaves the generator with no way to satisfy the
    // request. The constructive half is the mechanism: React state + conditional
    // render, with a transition when the prompt asks for animation.
    const section = tpl.slice(tpl.indexOf("An explicit in-frame instruction OVERRIDES"));
    expect(section).toMatch(/do NOT create a second frame and do NOT use `<FrameLink>`/);
    expect(section).toMatch(/`useState` \+ conditional render/);
  });

  it("disambiguates the 'pressing Save goes to the confirmation' example that failed", () => {
    // The offending line stays (it IS a FrameLink signal when the prompt is silent)
    // but now carries the caveat.
    expect(tpl).toContain('"pressing Save goes to the confirmation" — wrap the Save button. But ONLY when the prompt');
    expect(tpl).toContain("is an in-frame state change, not a `<FrameLink>`");
  });

  it("closes the create-frames-without-asking loophole", () => {
    // Without this, "create frames for only the new steps … Do NOT ask first" still
    // contradicts the override one screenful earlier.
    expect(tpl).toContain(
      "unless the prompt explicitly asks to stay in one frame, in which case add the new step inside the existing frame",
    );
    // Anchored to the rule it qualifies, not just present somewhere in the file.
    const rule = tpl.indexOf("the user has committed to multiple frames");
    const escape = tpl.indexOf("unless the prompt explicitly asks to stay in one frame");
    expect(rule).toBeGreaterThan(-1);
    expect(escape).toBeGreaterThan(rule);
    // Same paragraph — within one line of each other, not sections apart.
    expect(tpl.slice(rule, escape)).not.toContain("\n\n");
  });

  it("cites the session that motivated it, so a future reader can check the claim", () => {
    expect(tpl).toContain("2026-08-06 designer session");
  });
});

describe("the override survives RENDERING, not just the template source", () => {
  // The five tests above read `CLAUDE.md.tpl`. The generator never reads that file
  // — it reads the rendered `CLAUDE.md` in the project dir, produced by
  // `createProject` → `renderTemplate` (server/projects.ts). That is a
  // `{{VAR}}` → value substitution, so a placeholder accidentally introduced INSIDE
  // the override paragraph would leave a literal `{{…}}` in the generator's rules
  // while every source-level assertion above stayed green.
  //
  // Cheap to close, and it is the file the model actually obeys, so it is worth one
  // real project creation. Same reasoning as the middleware tests: the unit tests
  // prove the words are right, only this proves they ARRIVE.
  let tmp: string | undefined;

  afterEach(() => {
    delete process.env.ARCADE_STUDIO_ROOT;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("a real project's CLAUDE.md carries the override, with no unsubstituted placeholders", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-tpl-single-frame-"));
    process.env.ARCADE_STUDIO_ROOT = tmp;
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const rendered = fs.readFileSync(
      path.join(tmp, "projects", p.slug, "CLAUDE.md"),
      "utf8",
    );

    // The override, and the constructive half that tells the generator what to do
    // INSTEAD — a rule that only forbids leaves the request unsatisfiable.
    expect(rendered).toContain("An explicit in-frame instruction OVERRIDES every signal below");
    expect(rendered).toMatch(/do NOT create a second frame and do NOT use `<FrameLink>`/);
    expect(rendered).toMatch(/`useState` \+ conditional render/);
    // The verbatim designer phrasings, so recognition does not depend on paraphrase.
    expect(rendered).toContain("DON'T IMPLEMENT THIS AS A SEPARATE FRAME");
    expect(rendered).toContain("as a tab in the main frame");
    // The two rules it has to beat, both still qualified after rendering.
    expect(rendered).toContain(
      "unless the prompt explicitly asks to stay in one frame, in which case add the new step inside the existing frame",
    );
    expect(rendered).toContain("is an in-frame state change, not a `<FrameLink>`");
    // Ordering survives too: the override must precede the signal list it overrides,
    // because the generator is entitled to follow whichever rule it reads last.
    expect(rendered.indexOf("An explicit in-frame instruction OVERRIDES")).toBeLessThan(
      rendered.indexOf("**Signal patterns to watch for in the prompt:**"),
    );

    // No `{{PLACEHOLDER}}` left anywhere in the override paragraph.
    const start = rendered.indexOf("An explicit in-frame instruction OVERRIDES");
    const section = rendered.slice(start, rendered.indexOf("**Primitive:**", start));
    expect(section).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
