// studio/__tests__/components/inspector-props-panel.test.tsx
import { describe, it, expect } from "vitest";
import { renderPropField } from "../../src/components/inspector/propField";

// renderPropField is a pure helper extracted from the panel: given a KitProp2 + a
// current value + an onChange, it returns the field descriptor the panel renders.
describe("renderPropField (widget + write-prefix selection)", () => {
  it("text prop → text kind, prop: prefix", () => {
    const d = renderPropField({ name: "userName", kind: "text", default: "Ava Wright" }, undefined);
    expect(d.widget).toBe("text");
    expect(d.writePrefix).toBe("prop:");
    expect(d.value).toBe("Ava Wright"); // default when no current value
  });
  it("current value wins over default", () => {
    const d = renderPropField({ name: "userName", kind: "text", default: "Ava Wright" }, "Ada");
    expect(d.value).toBe("Ada");
  });
  it("select prop → select kind with values, prop: prefix", () => {
    const d = renderPropField({ name: "state", kind: "select", values: ["empty", "streaming", "transcript"], default: "transcript" }, undefined);
    expect(d.widget).toBe("select");
    expect(d.writePrefix).toBe("prop:");
    expect(d.values).toEqual(["empty", "streaming", "transcript"]);
    expect(d.value).toBe("transcript");
  });
  it("toggle prop → toggle kind, propExpr: prefix", () => {
    const d = renderPropField({ name: "withCanvasPanel", kind: "toggle" }, undefined);
    expect(d.widget).toBe("toggle");
    expect(d.writePrefix).toBe("propExpr:");
  });
  it("number prop → number kind, propExpr: prefix", () => {
    const d = renderPropField({ name: "count", kind: "number", default: "3" }, undefined);
    expect(d.widget).toBe("number");
    expect(d.writePrefix).toBe("propExpr:");
    expect(d.value).toBe("3");
  });
});
