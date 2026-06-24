import { describe, it, expect } from "vitest";
import { buildVisualEditPreamble } from "../../src/lib/visualEditPreamble";
import type { EditedElement, StyleSnapshot } from "../../src/hooks/editSessionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)",
  borderColor: "rgb(0,0,0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", gap: "0px", width: "80px", height: "32px",
  minWidth: "0px", maxWidth: "none", minHeight: "0px", maxHeight: "none",
  display: "block", flexDirection: "row", opacity: "1", borderRadius: "0px",
  appliedTokens: {},
};
function el(editId: number, pending: EditedElement["pending"], over: Partial<StyleSnapshot> = {}): EditedElement {
  return {
    selection: {
      editId, file: "/p/frames/home/index.tsx", line: editId * 10, column: 3,
      componentName: "Button", tagName: "button", textEditable: true,
      styles: { ...STYLES, ...over },
    },
    pending,
  };
}

describe("buildVisualEditPreamble (batch)", () => {
  it("returns '' when no element has pending changes", () => {
    expect(buildVisualEditPreamble([el(1, {}), el(2, {})], "home/index.tsx")).toBe("");
  });

  it("lists each changed element with its line:column and changes", () => {
    const out = buildVisualEditPreamble(
      [el(1, { fontSize: "18px" }), el(2, { color: "rgb(37,99,235)" })],
      "home/index.tsx",
    );
    expect(out).toContain("frames/home/index.tsx");
    expect(out).toContain("10:3");
    expect(out).toContain("font size: 14px -> 18px");
    expect(out).toContain("20:3");
    expect(out).toContain("text color: rgb(0,0,0) -> rgb(37,99,235)");
  });

  it("skips elements with no pending changes but keeps changed ones", () => {
    const out = buildVisualEditPreamble([el(1, {}), el(2, { fontSize: "20px" })], "home/index.tsx");
    expect(out).toContain("20:3");
    expect(out).not.toContain("10:3");
  });

  it("renders a text change in quotes and demands token-idiomatic output", () => {
    const out = buildVisualEditPreamble([el(1, { text: "Submit" })], "home/index.tsx");
    expect(out).toContain(`text content: "Save" -> "Submit"`);
    expect(out).toMatch(/Tailwind|token/i);
    expect(out).toContain("Edit");
  });

  it("labels the slice-1 layout/appearance fields", () => {
    const out = buildVisualEditPreamble(
      [el(1, { minWidth: "100px", opacity: "0.5", display: "flex" })],
      "home/index.tsx",
    );
    expect(out).toContain("min width:");
    expect(out).toContain("opacity:");
    expect(out).toContain("display:");
  });

  it("emits token-class edits as explicit class instructions (not raw-value mappings)", () => {
    const out = buildVisualEditPreamble(
      [el(1, { color: "tok:text-(--fg-success-prominent)" })],
      "home/index.tsx",
    );
    expect(out).toContain("text color: apply class `text-(--fg-success-prominent)`");
    expect(out).not.toContain("rgb");
  });

  it("labels typeStyle in pending keys", () => {
    const out = buildVisualEditPreamble(
      [el(1, { typeStyle: "tok:text-body-large" })],
      "home/index.tsx",
    );
    expect(out).toContain("type style: apply class `text-body-large`");
  });

  it("renders an icon swap as a component + import instruction", () => {
    const element: EditedElement = {
      selection: {
        editId: 1,
        file: "/p/frames/home/index.tsx",
        line: 8,
        column: 4,
        componentName: "Bell",
        tagName: "svg",
        textEditable: false,
        styles: STYLES,
        iconCandidate: "Bell",
      },
      pending: { iconSwap: "Star" },
    };
    const out = buildVisualEditPreamble([element], "home/index.tsx");
    expect(out).toContain("Star");
    expect(out).toMatch(/icon/i);
    expect(out).toMatch(/import/i);
  });
});
