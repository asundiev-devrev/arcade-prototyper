// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, disabled }: any) =>
    React.createElement("button", { onClick, disabled }, children),
}));

import { InspectorPanel } from "../../src/components/inspector/InspectorPanel";
import {
  TargetSelectionProvider,
  useTargetSelection,
  type StyleSnapshot,
  type TargetSelection,
} from "../../src/hooks/targetSelectionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)",
  borderColor: "rgb(0, 0, 0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", width: "80px", height: "32px",
};
const TARGET: TargetSelection = {
  file: "/p/frames/home/index.tsx", line: 1, column: 1,
  componentName: "Button", tagName: "button", frameSlug: "home", styles: STYLES,
};

// Harness exposing the context so the test can drive setTarget/setInspectorOpen.
function Harness({ onSend }: { onSend: any }) {
  const ctx = useTargetSelection();
  return (
    <>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.setTarget(TARGET); }}>
        open
      </button>
      <InspectorPanel onSend={onSend} busy={false} />
      <span data-testid="pending-fontSize">{ctx.pending.fontSize ?? ""}</span>
    </>
  );
}

afterEach(cleanup);

describe("InspectorPanel", () => {
  it("renders nothing until the inspector is open", () => {
    render(<TargetSelectionProvider><InspectorPanel onSend={vi.fn()} busy={false} /></TargetSelectionProvider>);
    expect(screen.queryByText(/Commit/i)).toBeNull();
  });

  it("shows the empty state when open with no target", () => {
    function OpenOnly() {
      const ctx = useTargetSelection();
      React.useEffect(() => ctx.setInspectorOpen(true), []); // eslint-disable-line
      return <InspectorPanel onSend={vi.fn()} busy={false} />;
    }
    render(<TargetSelectionProvider><OpenOnly /></TargetSelectionProvider>);
    expect(screen.getByText(/click an element/i)).toBeTruthy();
  });

  it("seeds controls from target styles and records a pending edit", () => {
    render(<TargetSelectionProvider><Harness onSend={vi.fn()} /></TargetSelectionProvider>);
    fireEvent.click(screen.getByText("open"));
    const fontSize = screen.getByLabelText(/font size/i) as HTMLInputElement;
    expect(fontSize.value).toBe("14"); // px stripped for the numeric field
    fireEvent.change(fontSize, { target: { value: "18" } });
    expect(screen.getByTestId("pending-fontSize").textContent).toBe("18px");
  });

  it("Commit calls onSend with a preamble containing the change, then clears", () => {
    const onSend = vi.fn();
    render(<TargetSelectionProvider><Harness onSend={onSend} /></TargetSelectionProvider>);
    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/font size/i), { target: { value: "18" } });
    fireEvent.click(screen.getByText(/Commit/i));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toContain("font size: 14px -> 18px");
  });
});
