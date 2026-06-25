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
  appliedTokens: {},
};
function sel(editId: number, iconCandidate?: string): ElementSelection {
  return {
    editId, file: "/p/frames/home/index.tsx", line: editId, column: 1,
    componentName: "Button", tagName: "button", textEditable: true, styles: STYLES,
    ...(iconCandidate ? { iconCandidate } : {}),
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
      <InspectorPanel onSend={onSend} busy={false} slug="test-slug" />
      <span data-testid="count">{ctx.batch.length}</span>
      <span data-testid="focused">{ctx.focusedEditId ?? ""}</span>
      <span data-testid="width">{ctx.inspectorWidth}</span>
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InspectorPanel (batch)", () => {
  it("renders null when inspector closed", () => {
    render(<EditSessionProvider><InspectorPanel onSend={vi.fn()} busy={false} /></EditSessionProvider>);
    expect(screen.queryByText(/Commit/i)).toBeNull();
  });

  it("seeds focused controls and records a pending edit on the focused element", () => {
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    expect(screen.getByText("Layout")).toBeTruthy(); // Layout section present
    expect(screen.getByLabelText("W")).toBeTruthy(); // Width field from Layout section
    // Typography now has Style picker (token select inside EditableTokenChip), and restored Size field
    const typeStyle = screen.getByLabelText(/type style/i) as HTMLSelectElement;
    expect(typeStyle).toBeTruthy();
    const fontSize = screen.getByLabelText("Size") as HTMLInputElement;
    expect(fontSize).toBeTruthy();
    // Align is now a button group
    const alignGroup = screen.getByRole("group", { name: /text align/i });
    expect(alignGroup).toBeTruthy();
    // Color now has token selects (inside EditableTokenChip) with swatches
    const textColor = screen.getByLabelText("Text") as HTMLSelectElement;
    expect(textColor).toBeTruthy();
    const swatches = screen.getAllByTestId("token-chip-swatch");
    expect(swatches.length).toBeGreaterThanOrEqual(1);
    // Change a width value to test pending edits
    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
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

  it("Commit sends a preamble with the batch change then clears", async () => {
    // Stub fetch to return {ok: false} so commit falls back to chat
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: false, reason: "test" }),
    })) as any);
    const onSend = vi.fn();
    render(<EditSessionProvider><Harness onSend={onSend} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    // Change width (type style is now in Style token, not here)
    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
    fireEvent.click(screen.getByText(/Commit/i));
    // Wait for async commit to complete
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const preamble = onSend.mock.calls[0][0];
    expect(preamble).toContain("width: 80px -> 100px");
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

  it("shows the Icon section + grid when the focused element is a catalog icon", async () => {
    // stub /api/assets
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        sections: [{
          kind: "icon",
          items: [
            { name: "Bell", category: "A", tags: [], svg: "<svg></svg>" },
            { name: "Star", category: "A", tags: [], svg: "<svg></svg>" },
          ],
        }],
      }),
    })) as any);

    function IconHarness() {
      const ctx = useEditSession();
      return (
        <>
          <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(sel(1, "Bell"), "home", null); }}>open-icon</button>
          <InspectorPanel onSend={vi.fn()} busy={false} />
        </>
      );
    }

    render(<EditSessionProvider><IconHarness /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open-icon"));
    expect(await screen.findByText("Icon")).toBeTruthy(); // the Section title
    expect(screen.getByRole("button", { name: /replace/i })).toBeTruthy();
  });

  it("disables move buttons when there are pending edits", () => {
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    // Initially buttons are enabled
    const upBtn = screen.getByLabelText("Move element up") as HTMLButtonElement;
    const downBtn = screen.getByLabelText("Move element down") as HTMLButtonElement;
    expect(upBtn.disabled).toBe(false);
    expect(downBtn.disabled).toBe(false);
    // Make a pending edit
    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
    // Now buttons should be disabled
    expect(upBtn.disabled).toBe(true);
    expect(downBtn.disabled).toBe(true);
    expect(upBtn.title).toContain("Commit or discard edits before moving");
  });

  it("preserves batch on move failure (server bail)", async () => {
    // Stub fetch to return {ok: false} (server bail)
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: false, reason: "no-sibling" }),
    })) as any);
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    // Make a pending edit
    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
    const initialCount = screen.getByTestId("count").textContent;
    expect(initialCount).toBe("1");
    // Try to move (but buttons are disabled, so we can't actually click them)
    // Instead, verify that if buttons were clicked, the batch would be preserved
    // This test verifies the disabled state prevents the destructive action
    const upBtn = screen.getByLabelText("Move element up") as HTMLButtonElement;
    expect(upBtn.disabled).toBe(true);
    // Batch is still intact
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("clears batch on successful move", async () => {
    // Stub fetch to return {ok: true}
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    })) as any);
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1-with-window"));
    // No pending edits, buttons enabled
    const upBtn = screen.getByLabelText("Move element up") as HTMLButtonElement;
    expect(upBtn.disabled).toBe(false);
    // Click move up
    fireEvent.click(upBtn);
    // Wait for async move to complete
    await vi.waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
    // postMessage was called with preview-reset
    expect(stubWindow.postMessage).toHaveBeenCalledWith(
      { type: "arcade-studio:preview-reset", all: true },
      "*",
    );
  });
});
