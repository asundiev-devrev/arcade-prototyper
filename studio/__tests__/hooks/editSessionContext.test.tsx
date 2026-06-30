// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  EditSessionProvider, useEditSession,
  type ElementSelection, type StyleSnapshot,
  isTokenPending, tokenClass,
} from "../../src/hooks/editSessionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)",
  borderColor: "rgb(0, 0, 0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", gap: "0px", width: "80px", height: "32px",
  minWidth: "0px", maxWidth: "none", minHeight: "0px", maxHeight: "none",
  display: "block", flexDirection: "row", opacity: "1", borderRadius: "0px",
};
function sel(editId: number, over: Partial<ElementSelection> = {}): ElementSelection {
  return {
    editId, file: "/p/frames/home/index.tsx", line: editId, column: 1,
    componentName: "Button", tagName: "button", textEditable: true, styles: STYLES,
    ownerChain: [], ...over,
  };
}
const wrap = ({ children }: { children: React.ReactNode }) => (
  <EditSessionProvider>{children}</EditSessionProvider>
);

describe("editSessionContext", () => {
  it("addOrFocus appends a new element and focuses it", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => result.current.addOrFocus(sel(1), "home", null));
    expect(result.current.batch).toHaveLength(1);
    expect(result.current.focusedEditId).toBe(1);
    expect(result.current.frameSlug).toBe("home");
  });

  it("addOrFocus on an existing editId re-focuses without duplicating or losing pending", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => result.current.addOrFocus(sel(1), "home", null));
    act(() => result.current.setField(1, "fontSize", "18px"));
    act(() => result.current.addOrFocus(sel(2), "home", null));
    act(() => result.current.addOrFocus(sel(1), "home", null)); // re-pick #1
    expect(result.current.batch).toHaveLength(2);
    expect(result.current.focusedEditId).toBe(1);
    expect(result.current.batch.find((e) => e.selection.editId === 1)!.pending.fontSize).toBe("18px");
  });

  it("setField / resetField mutate only the named element", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => { result.current.addOrFocus(sel(1), "home", null); result.current.addOrFocus(sel(2), "home", null); });
    act(() => result.current.setField(1, "color", "rgb(1,2,3)"));
    expect(result.current.batch.find((e) => e.selection.editId === 1)!.pending.color).toBe("rgb(1,2,3)");
    expect(result.current.batch.find((e) => e.selection.editId === 2)!.pending.color).toBeUndefined();
    act(() => result.current.resetField(1, "color"));
    expect(result.current.batch.find((e) => e.selection.editId === 1)!.pending.color).toBeUndefined();
  });

  it("removeElement drops it and re-points focus", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => { result.current.addOrFocus(sel(1), "home", null); result.current.addOrFocus(sel(2), "home", null); });
    act(() => result.current.removeElement(2));
    expect(result.current.batch).toHaveLength(1);
    expect(result.current.focusedEditId).toBe(1);
  });

  it("clear wipes batch, focus, frame, inspectorOpen, frameWindow", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => { result.current.addOrFocus(sel(1), "home", null); result.current.setInspectorOpen(true); });
    act(() => result.current.clear());
    expect(result.current.batch).toHaveLength(0);
    expect(result.current.focusedEditId).toBeNull();
    expect(result.current.frameSlug).toBeNull();
    expect(result.current.inspectorOpen).toBe(false);
    expect(result.current.frameWindow).toBeNull();
  });

  it("inspectorWidth defaults to 360 and is settable", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    expect(result.current.inspectorWidth).toBe(360);
    act(() => result.current.setInspectorWidth(420));
    expect(result.current.inspectorWidth).toBe(420);
  });

  it("clear() preserves inspectorWidth (width persists across sessions)", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => result.current.setInspectorWidth(500));
    act(() => result.current.clear());
    expect(result.current.inspectorWidth).toBe(500);
  });

  it("shiftSelectionsBelow shifts only selections strictly below the edited line", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    // sel(N) seeds line = N (see helper). Pick lines 5, 10, 15.
    act(() => {
      result.current.addOrFocus(sel(5, { line: 5 }), "home", null);
      result.current.addOrFocus(sel(10, { line: 10 }), "home", null);
      result.current.addOrFocus(sel(15, { line: 15 }), "home", null);
    });
    // A write at line 10 added 2 lines.
    act(() => result.current.shiftSelectionsBelow(10, 2));
    const byId = (id: number) => result.current.batch.find((e) => e.selection.editId === id)!;
    expect(byId(5).selection.line).toBe(5);   // above — untouched
    expect(byId(10).selection.line).toBe(10); // the edited line itself — untouched
    expect(byId(15).selection.line).toBe(17); // below — shifted by +2
  });

  it("shiftSelectionsBelow with a negative delta moves below-selections up", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => {
      result.current.addOrFocus(sel(8, { line: 8 }), "home", null);
      result.current.addOrFocus(sel(20, { line: 20 }), "home", null);
    });
    act(() => result.current.shiftSelectionsBelow(8, -1));
    const byId = (id: number) => result.current.batch.find((e) => e.selection.editId === id)!;
    expect(byId(8).selection.line).toBe(8);   // edited line — untouched
    expect(byId(20).selection.line).toBe(19); // below — shifted by -1
  });
});

describe("token pending helpers", () => {
  it("token pending helpers detect and unwrap the tok: sentinel", () => {
    expect(isTokenPending("tok:text-body")).toBe(true);
    expect(isTokenPending("16px")).toBe(false);
    expect(isTokenPending(undefined)).toBe(false);
    expect(tokenClass("tok:text-(--fg-neutral-subtle)")).toBe("text-(--fg-neutral-subtle)");
  });
});
