// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildEditContextBlock, prependEditContext } from "../../server/editContext";

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
      "Target element: <div> inside <Frame>\nSource: frames/01-home/index.tsx:10:2\n\nmake it blue";
    expect(prependEditContext(prompt, ["01-home"])).toBe(prompt);
  });

  it("is idempotent when an edit_context block is already present", () => {
    const once = prependEditContext("tweak copy", ["01-home"]);
    expect(prependEditContext(once, ["01-home"])).toBe(once);
  });
});
