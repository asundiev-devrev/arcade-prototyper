import { describe, it, expect } from "vitest";
import { buildVisualEditPreamble } from "../../src/lib/visualEditPreamble";
import type { TargetSelection } from "../../src/hooks/targetSelectionContext";

const TARGET: TargetSelection = {
  file: "/Users/x/projects/demo/frames/home/index.tsx",
  line: 42, column: 7, componentName: "Button", tagName: "button",
  frameSlug: "home",
  styles: {
    text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
    textAlign: "left", color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)",
    borderColor: "rgb(0,0,0)", paddingTop: "0px", paddingRight: "0px",
    paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
    marginBottom: "0px", marginLeft: "0px", gap: "0px", width: "80px", height: "32px",
  },
};

describe("buildVisualEditPreamble", () => {
  it("includes the relative frame path and line:column", () => {
    const out = buildVisualEditPreamble(TARGET, { fontSize: "18px" });
    expect(out).toContain("frames/home/index.tsx:42:7");
  });

  it("lists each pending change as an original -> new line", () => {
    const out = buildVisualEditPreamble(TARGET, { fontSize: "18px", color: "rgb(37,99,235)" });
    expect(out).toContain("font size: 14px -> 18px");
    expect(out).toContain("text color: rgb(0,0,0) -> rgb(37,99,235)");
  });

  it("renders a text-content change in quotes", () => {
    const out = buildVisualEditPreamble(TARGET, { text: "Submit" });
    expect(out).toContain(`text content: "Save" -> "Submit"`);
  });

  it("instructs idiomatic Tailwind/token output and forbids a no-op turn", () => {
    const out = buildVisualEditPreamble(TARGET, { fontSize: "18px" });
    expect(out).toMatch(/Tailwind|token/i);
    expect(out).toContain("Edit");
  });

  it("returns an empty string when there are no pending changes", () => {
    expect(buildVisualEditPreamble(TARGET, {})).toBe("");
  });
});
