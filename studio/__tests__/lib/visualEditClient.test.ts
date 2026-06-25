import { describe, it, expect } from "vitest";
import {
  toElementEdits, isInFrame, buildComponentEditPreamble,
} from "../../src/lib/visualEditClient";
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
  it("uses the explicit session frameSlug, not the picked file path", () => {
    // The picked element resolves to a kit source file (no /frames/), but the
    // session knows the real frame is 01-x. The payload must target 01-x.
    const r = toElementEdits(
      [el({ file: "/p/studio/prototype-kit/dist/composites/ChatMessages.js" }, { paddingTop: "24px" })],
      "01-x",
    );
    expect(r.frameSlug).toBe("01-x");
  });
  it("passes raw values through and strips text/icon into their own fields", () => {
    const r = toElementEdits([el({}, {
      paddingTop: "24px",
      color: "tok:text-(--fg-muted)",
      text: "Save",
      iconSwap: "Trash",
    })], "01-x");
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

describe("isInFrame", () => {
  it("is true when the picked file lives in this frame's directory", () => {
    expect(isInFrame("/p/projects/demo/frames/01-x/index.tsx", "01-x")).toBe(true);
  });
  it("is false when the picked file is kit/shared source", () => {
    expect(isInFrame("/p/studio/prototype-kit/dist/composites/ChatMessages.js", "01-x")).toBe(false);
  });
  it("is false for a different frame's file", () => {
    expect(isInFrame("/p/projects/demo/frames/02-y/index.tsx", "01-x")).toBe(false);
  });
  it("is false when frameSlug is empty", () => {
    expect(isInFrame("/p/projects/demo/frames/01-x/index.tsx", "")).toBe(false);
  });
});

describe("buildComponentEditPreamble", () => {
  const offFrame = el(
    { file: "/p/studio/prototype-kit/dist/composites/ChatMessages.js",
      componentName: "ComputerHeader", tagName: "div" },
    { paddingTop: "18px" },
  );

  it("targets the frame's own index.tsx, never the kit file", () => {
    const out = buildComponentEditPreamble([offFrame], "01-computer");
    expect(out).toContain("frames/01-computer/index.tsx");
    expect(out).not.toContain("ChatMessages.js");
  });
  it("instructs duplicate-and-edit-locally and forbids editing the shared kit", () => {
    const out = buildComponentEditPreamble([offFrame], "01-computer");
    expect(out.toLowerCase()).toContain("prototype-kit");   // names the off-limits dir
    expect(out.toLowerCase()).toMatch(/do not (edit|modify|change)/);
    // describes the change semantically (no kit line:column)
    expect(out).toMatch(/padding/i);
    expect(out).not.toMatch(/line \d+:\d+/);
  });
  it("returns empty string when nothing actually changed", () => {
    const empty = el({ file: "/p/studio/prototype-kit/x.js", componentName: "Card" }, {});
    expect(buildComponentEditPreamble([empty], "01-x")).toBe("");
  });
});
