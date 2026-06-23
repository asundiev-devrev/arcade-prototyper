// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  TargetSelectionProvider,
  useTargetSelection,
  type StyleSnapshot,
} from "../../src/hooks/targetSelectionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)",
  borderColor: "rgb(0, 0, 0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", gap: "0px", width: "80px", height: "32px",
};

function wrap({ children }: { children: React.ReactNode }) {
  return <TargetSelectionProvider>{children}</TargetSelectionProvider>;
}

describe("targetSelectionContext", () => {
  it("sets a target with styles and reports inspector closed by default", () => {
    const { result } = renderHook(() => useTargetSelection(), { wrapper: wrap });
    expect(result.current.target).toBeNull();
    expect(result.current.inspectorOpen).toBe(false);
    act(() => {
      result.current.setTarget({
        file: "/frames/a/index.tsx", line: 10, column: 5,
        componentName: "Button", tagName: "button", frameSlug: "a", styles: STYLES,
      });
    });
    expect(result.current.target?.styles.fontSize).toBe("14px");
  });

  it("sets and resets a pending field", () => {
    const { result } = renderHook(() => useTargetSelection(), { wrapper: wrap });
    act(() => result.current.setPendingField("fontSize", "18px"));
    expect(result.current.pending.fontSize).toBe("18px");
    act(() => result.current.resetPendingField("fontSize"));
    expect(result.current.pending.fontSize).toBeUndefined();
  });

  it("clear() wipes target, pending, inspectorOpen and frameWindow", () => {
    const { result } = renderHook(() => useTargetSelection(), { wrapper: wrap });
    act(() => {
      result.current.setInspectorOpen(true);
      result.current.setPendingField("color", "rgb(1,2,3)");
    });
    act(() => result.current.clear());
    expect(result.current.target).toBeNull();
    expect(result.current.pending).toEqual({});
    expect(result.current.inspectorOpen).toBe(false);
    expect(result.current.frameWindow).toBeNull();
  });
});
