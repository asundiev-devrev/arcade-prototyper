// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, disabled }: any) =>
    React.createElement("button", { onClick, disabled }, children),
}));

import { InspectorPanel } from "../../src/components/inspector/InspectorPanel";
import {
  EditSessionProvider, useEditSession,
  type ElementSelection, type StyleSnapshot,
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
function sel(editId: number): ElementSelection {
  return {
    editId, file: "/p/frames/home/index.tsx", line: editId, column: 1,
    componentName: "Button", tagName: "button", textEditable: true, styles: STYLES,
  };
}
const stubWindow = { postMessage: vi.fn() } as unknown as Window;

function Harness({ onSend }: { onSend: any }) {
  const ctx = useEditSession();
  return (
    <>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(sel(1), "home", null); }}>open1</button>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(sel(1), "home", stubWindow); }}>open1-with-window</button>
      <button onClick={() => ctx.addOrFocus(sel(2), "home", null)}>add2</button>
      <InspectorPanel onSend={onSend} busy={false} />
      <span data-testid="count">{ctx.batch.length}</span>
      <span data-testid="focused">{ctx.focusedEditId ?? ""}</span>
      <span data-testid="width">{ctx.inspectorWidth}</span>
    </>
  );
}
afterEach(cleanup);

describe("InspectorPanel (batch)", () => {
  it("renders null when inspector closed", () => {
    render(<EditSessionProvider><InspectorPanel onSend={vi.fn()} busy={false} /></EditSessionProvider>);
    expect(screen.queryByText(/Commit/i)).toBeNull();
  });

  it("seeds focused controls and records a pending edit on the focused element", () => {
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    const fontSize = screen.getByLabelText(/font size/i) as HTMLInputElement;
    expect(fontSize.value).toBe("14");
    fireEvent.change(fontSize, { target: { value: "18" } });
    // batch element #1 now has the pending change; commit proves it (below)
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("shows a batch list with two elements after a second pick", () => {
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    fireEvent.click(screen.getByText("add2"));
    expect(screen.getByTestId("count").textContent).toBe("2");
    // two list rows labelled by tag
    expect(screen.getAllByText(/button/i).length).toBeGreaterThanOrEqual(2);
  });

  it("Commit sends a preamble with the batch change then clears", () => {
    const onSend = vi.fn();
    render(<EditSessionProvider><Harness onSend={onSend} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    fireEvent.change(screen.getByLabelText(/font size/i), { target: { value: "18" } });
    fireEvent.click(screen.getByText(/Commit/i));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toContain("font size: 14px -> 18px");
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("does NOT render a Text input (text is edited in place)", () => {
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    expect(screen.queryByLabelText(/text content/i)).toBeNull();
  });

  it("resize handle widens the panel when dragged left", () => {
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    const initialWidth = parseInt(screen.getByTestId("width").textContent || "360", 10);
    const handle = screen.getByRole("separator", { name: /resize inspector/i });
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 50 }); // drag left
    const newWidth = parseInt(screen.getByTestId("width").textContent || "360", 10);
    expect(newWidth).toBeGreaterThan(initialWidth);
  });

  it("removing an element sends preview-reset postMessage", () => {
    vi.clearAllMocks();
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1-with-window"));
    const removeBtn = screen.getByLabelText(/remove element 1/i);
    fireEvent.click(removeBtn);
    expect(stubWindow.postMessage).toHaveBeenCalledWith(
      { type: "arcade-studio:preview-reset", editId: 1 },
      "*",
    );
    expect(screen.getByTestId("count").textContent).toBe("0");
  });
});
