// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildEditContextBlock, prependEditContext } from "../../server/editContext";
import { SCOPED_EDIT_MARKER } from "../../src/lib/scopedEdit";

describe("buildEditContextBlock", () => {
  it("lists the existing frame slugs and the two hard rules", () => {
    const block = buildEditContextBlock(["01-home", "02-settings"]);
    expect(block).toContain("<edit_context>");
    expect(block).toContain("</edit_context>");
    expect(block).toContain("01-home, 02-settings");
    expect(block).toContain("is LAW");
    expect(block).toContain("FAILED turn");
  });
});

describe("prependEditContext", () => {
  it("prepends the block when frames exist and prompt is a plain edit", () => {
    const out = prependEditContext("make the header red", ["01-home"]);
    expect(out.startsWith("<edit_context>")).toBe(true);
    expect(out).toContain("make the header red");
    expect(out).toContain("01-home");
  });

  it("is a no-op on the first build (no frames yet)", () => {
    expect(prependEditContext("build a settings page", [])).toBe(
      "build a settings page",
    );
  });

  it("does not double-inject when a client target preamble is present", () => {
    const prompt =
      SCOPED_EDIT_MARKER +
      "\n\nTarget element: <div> inside <Frame>\nSource: frames/01-home/index.tsx:10:2\n\nmake it blue";
    expect(prependEditContext(prompt, ["01-home"])).toBe(prompt);
  });

  // Regression (marker fragility): the plural + baked preambles carry the same
  // sentinel, so prependEditContext must NOT stack a second <edit_context> block
  // on top of them either (the old singular-string check double-injected here).
  it("does not double-inject for a multi-select or baked preamble", () => {
    const multi = SCOPED_EDIT_MARKER + "\n\nTarget elements:\n- <div> A\n- <div> B\n\nmake them blue";
    expect(prependEditContext(multi, ["01-home"])).toBe(multi);
    const baked =
      SCOPED_EDIT_MARKER +
      "\n\nTarget element rendered from a SHARED prototype-kit component, with no editable usage in the frame source:\n- <Chip>\n\nrecolor it";
    expect(prependEditContext(baked, ["01-home"])).toBe(baked);
  });

  it("is idempotent when an edit_context block is already present", () => {
    const once = prependEditContext("tweak copy", ["01-home"]);
    expect(prependEditContext(once, ["01-home"])).toBe(once);
  });
});
