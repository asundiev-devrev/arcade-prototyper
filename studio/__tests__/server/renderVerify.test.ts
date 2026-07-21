// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  extractRequestedProperties,
  reconcile,
  RENDER_VERIFY_RETRY_PROMPT,
  renderVerifyAlreadyRan,
  markRenderVerifyRan,
} from "../../server/renderVerify";

const carrier = (flexDirection: string, dataOrientation = "vertical") => ({
  tag: "div", dataOrientation, role: null,
  styles: { flexDirection, color: "x", backgroundColor: "x" },
});

describe("extractRequestedProperties (from the USER prompt)", () => {
  it("maps 'make the toggle groups vertical' → orientation vertical", () => {
    expect(extractRequestedProperties("make the toggle groups vertical")).toEqual([
      { property: "orientation", expected: "vertical" },
    ]);
  });
  it("maps 'stack them' / 'in a column' → vertical", () => {
    expect(extractRequestedProperties("can you stack them")[0]?.expected).toBe("vertical");
    expect(extractRequestedProperties("put them in a column")[0]?.expected).toBe("vertical");
  });
  it("maps 'side by side' / 'horizontal' → horizontal", () => {
    expect(extractRequestedProperties("lay them out horizontally")[0]?.expected).toBe("horizontal");
    expect(extractRequestedProperties("put them side by side")[0]?.expected).toBe("horizontal");
  });
  it("extracts NOTHING from a non-visual / ambiguous prompt (bias to silence)", () => {
    expect(extractRequestedProperties("clean this up")).toEqual([]);
    expect(extractRequestedProperties("make it nicer")).toEqual([]);
    expect(extractRequestedProperties("wire the button to open the modal")).toEqual([]);
  });
  // FALSE-FIRE guards (the cardinal sin) — the orientation word is present but
  // NOT a layout directive. Must extract NOTHING.
  it("does NOT extract when the orientation word is an adjective on a noun ('the vertical scrollbar')", () => {
    expect(extractRequestedProperties("make the vertical scrollbar bigger")).toEqual([]);
    expect(extractRequestedProperties("hide the horizontal divider")).toEqual([]);
  });
  it("does NOT extract under negation ('don't make it vertical')", () => {
    expect(extractRequestedProperties("don't make it vertical")).toEqual([]);
    expect(extractRequestedProperties("do not stack them")).toEqual([]);
    expect(extractRequestedProperties("keep it from being vertical")).toEqual([]);
  });
});

describe("reconcile (UNANIMOUS contradiction only — compares COMPUTED flexDirection)", () => {
  const wantVertical: any = [{ property: "orientation", expected: "vertical" }];
  it("ALL carriers render row vs vertical → mismatch (the repro)", () => {
    const digest = { elements: [carrier("row"), carrier("row")], truncated: false };
    expect(reconcile(wantVertical, digest).length).toBe(1);
  });
  it("ALL carriers render column vs vertical → no mismatch", () => {
    const digest = { elements: [carrier("column"), carrier("column")], truncated: false };
    expect(reconcile(wantVertical, digest)).toEqual([]);
  });
  it("MIXED (one row, one column) → NO mismatch (never false-fire on a mixed page)", () => {
    const digest = { elements: [carrier("row"), carrier("column")], truncated: false };
    expect(reconcile(wantVertical, digest)).toEqual([]);
  });
  it("ZERO carriers → no mismatch (nothing to judge)", () => {
    const digest = { elements: [{ tag: "button", dataOrientation: null, role: null, styles: { flexDirection: "row" } }], truncated: false };
    expect(reconcile(wantVertical, digest)).toEqual([]);
  });
  it("compares COMPUTED, not the attribute: data-orientation='vertical' but flex row → mismatch", () => {
    const digest = { elements: [carrier("row", "vertical")], truncated: false };
    expect(reconcile(wantVertical, digest).length).toBe(1);
  });
  it("ambiguous computed direction (neither row nor column) → no mismatch", () => {
    const digest = { elements: [carrier("")], truncated: false };
    expect(reconcile(wantVertical, digest)).toEqual([]);
  });
});

describe("one-shot (own Set, per user-turn)", () => {
  it("reports run after marking", () => {
    expect(renderVerifyAlreadyRan("rv-1")).toBe(false);
    markRenderVerifyRan("rv-1");
    expect(renderVerifyAlreadyRan("rv-1")).toBe(true);
    expect(renderVerifyAlreadyRan("rv-2")).toBe(false);
  });
});

describe("RENDER_VERIFY_RETRY_PROMPT", () => {
  it("names the mismatch + tells the agent it can be satisfied or reported", () => {
    const p = RENDER_VERIFY_RETRY_PROMPT({ property: "orientation", expected: "vertical", rendered: "horizontal" });
    expect(p).toMatch(/vertical/i);
    expect(p).toMatch(/horizontal|renders/i);
    expect(p).toMatch(/flex-col|stacked|tell the user|couldn't/i);
    expect(p).toMatch(/never (report|claim)/i);
  });
});
