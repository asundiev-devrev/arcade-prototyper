// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { setLayoutGuides, getLayoutGuidesFor, clearAllLayoutGuides } from "../../../src/frame/overlay/layoutGuides";

beforeEach(() => clearAllLayoutGuides());

describe("layoutGuides", () => {
  it("stores and retrieves layout guide config for an element id", () => {
    setLayoutGuides("el-1", [{ kind: "columns", count: 12, color: "#000", opacity: 50, visible: true, align: "stretch", size: "80", margin: "0", gutter: "0" }], true);
    const got = getLayoutGuidesFor("el-1");
    expect(got).not.toBeNull();
    expect(got!.sectionVisible).toBe(true);
    expect(Array.isArray(got!.layers)).toBe(true);
  });
  it("clearAll wipes stored guides", () => {
    setLayoutGuides("el-1", [{ kind: "columns", count: 12, color: "#000", opacity: 50, visible: true, align: "stretch", size: "80", margin: "0", gutter: "0" }], true);
    clearAllLayoutGuides();
    expect(getLayoutGuidesFor("el-1")).toBeNull();
  });
});
