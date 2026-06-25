import { describe, it, expect } from "vitest";
import { toElementEdits } from "../../src/lib/visualEditClient";
import type { EditedElement } from "../../src/hooks/editSessionContext";

function el(over: Partial<EditedElement["selection"]>, pending: EditedElement["pending"]): EditedElement {
  return {
    selection: {
      editId: 1, file: "/p/projects/demo/frames/01-x/index.tsx", line: 3, column: 6,
      componentName: "div", tagName: "div", textEditable: true,
      styles: {} as any, ...over,
    },
    pending,
  };
}

describe("toElementEdits", () => {
  it("derives frameSlug from the file path", () => {
    const r = toElementEdits([el({}, { paddingTop: "24px" })]);
    expect(r.frameSlug).toBe("01-x");
  });
  it("passes raw values through and strips text/icon into their own fields", () => {
    const r = toElementEdits([el({}, {
      paddingTop: "24px",
      color: "tok:text-(--fg-muted)",
      text: "Save",
      iconSwap: "Trash",
    })]);
    const e = r.edits[0];
    expect(e.text).toBe("Save");
    expect(e.iconSwap).toBe("Trash");
    expect(e.fields).toContainEqual({ field: "paddingTop", value: "24px" });
    expect(e.fields).toContainEqual({ field: "color", value: "tok:text-(--fg-muted)" });
    // text & iconSwap must NOT appear in fields
    expect(e.fields.find((f) => f.field === "text")).toBeUndefined();
    expect(e.fields.find((f) => f.field === "iconSwap")).toBeUndefined();
  });
});
