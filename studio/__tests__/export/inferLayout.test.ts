// @vitest-environment node
import { describe, it, expect } from "vitest";
import { inferLayout, type StyleLike } from "../../src/export/inferLayout";
import type { Box } from "../../src/export/slj";

const flexCol: StyleLike = {
  display: "flex",
  flexDirection: "column",
  columnGap: "0px",
  rowGap: "8px",
  paddingTop: "12px",
  paddingRight: "16px",
  paddingBottom: "12px",
  paddingLeft: "16px",
  alignItems: "flex-start",
  marginLeft: "0px",
};

describe("inferLayout", () => {
  it("maps a flex column to vertical auto-layout with gap + padding + align", () => {
    const layout = inferLayout(flexCol, []);
    expect(layout).toEqual({
      mode: "vertical",
      gap: 8,
      padding: [12, 16, 12, 16],
      align: "start",
    });
  });

  it("maps a flex row to horizontal and translates align values", () => {
    const layout = inferLayout(
      { ...flexCol, flexDirection: "row", columnGap: "6px", rowGap: "0px", alignItems: "center" },
      [],
    );
    expect(layout).toEqual({ mode: "horizontal", gap: 6, padding: [12, 16, 12, 16], align: "center" });
  });

  it("returns null for a non-flex container (irregular → absolute fallback)", () => {
    expect(inferLayout({ ...flexCol, display: "block" }, [])).toBeNull();
  });

  it("returns null when any child overlaps another along the main axis", () => {
    const boxes: Box[] = [
      { x: 0, y: 0, width: 100, height: 20 },
      { x: 0, y: 10, width: 100, height: 20 }, // overlaps the first vertically
    ];
    expect(inferLayout(flexCol, boxes)).toBeNull();
  });

  it("returns null when a negative margin is present", () => {
    expect(inferLayout({ ...flexCol, marginLeft: "-6px" }, [])).toBeNull();
  });

  it("returns null when children overlap along the horizontal main axis", () => {
    const boxes: Box[] = [
      { x: 0, y: 0, width: 100, height: 20 },
      { x: 90, y: 0, width: 100, height: 20 }, // overlaps the first horizontally
    ];
    expect(inferLayout({ ...flexCol, flexDirection: "row" }, boxes)).toBeNull();
  });
});
