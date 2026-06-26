// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, disabled }: any) =>
    React.createElement("button", { onClick, disabled }, children),
  useToast: () => ({ toast: () => {}, dismiss: () => {} }),
}));

import { InspectorPanel } from "../../src/components/inspector/InspectorPanel";
import {
  EditSessionProvider, useEditSession,
  type ElementSelection, type StyleSnapshot,
} from "../../src/hooks/editSessionContext";
import {
  EditBlocksProvider, useEditBlocks, type EditBlock,
} from "../../src/hooks/editBlocksContext";

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
    ownerChain: [],
    ...(iconCandidate ? { iconCandidate } : {}),
  };
}
const stubWindow = { postMessage: vi.fn() } as unknown as Window;

// Probe so tests can read the emitted edit-blocks out of context.
let capturedBlocks: EditBlock[] = [];
function BlocksProbe() {
  const { blocks } = useEditBlocks();
  capturedBlocks = blocks;
  return null;
}

function Harness({ onSend }: { onSend: any }) {
  const ctx = useEditSession();
  return (
    <>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(sel(1), "home", null); }}>open1</button>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(sel(1), "home", stubWindow); }}>open1-with-window</button>
      <button onClick={() => ctx.addOrFocus(sel(2), "home", null)}>add2</button>
      <InspectorPanel onSend={onSend} busy={false} slug="test-slug" />
      <BlocksProbe />
      <span data-testid="count">{ctx.batch.length}</span>
      <span data-testid="focused">{ctx.focusedEditId ?? ""}</span>
      <span data-testid="width">{ctx.inspectorWidth}</span>
    </>
  );
}

// Render the whole inspector inside BOTH providers (the real app wires them in
// ProjectDetail). InspectorPanel now requires EditBlocksProvider.
function renderHarness(onSend: any) {
  return render(
    <EditSessionProvider>
      <EditBlocksProvider>
        <Harness onSend={onSend} />
      </EditBlocksProvider>
    </EditSessionProvider>,
  );
}

beforeEach(() => {
  // Default fetch stub so the debounced deterministic write (scheduleApply) never
  // hits a missing global. Individual tests override this where they assert on it.
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ ok: true }),
  })) as any);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  capturedBlocks = [];
});

describe("InspectorPanel (instant-apply)", () => {
  it("renders null when inspector closed", () => {
    render(
      <EditSessionProvider>
        <EditBlocksProvider>
          <InspectorPanel onSend={vi.fn()} busy={false} slug="test-slug" />
        </EditBlocksProvider>
      </EditSessionProvider>,
    );
    expect(screen.queryByText(/Commit/i)).toBeNull();
  });

  it("renders NO Commit button when an element is focused", () => {
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open1"));
    // The whole point of the rewrite: there is no Commit affordance.
    expect(screen.queryByText(/Commit/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /commit/i })).toBeNull();
  });

  it("seeds focused controls and stages a pending edit on the focused element", () => {
    renderHarness(vi.fn());
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
    // Change a width value — it stages into the batch (and the live preview).
    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("shows a batch list with two elements after a second pick", () => {
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open1"));
    fireEvent.click(screen.getByText("add2"));
    expect(screen.getByTestId("count").textContent).toBe("2");
    // two list rows labelled by tag
    expect(screen.getAllByText(/button/i).length).toBeGreaterThanOrEqual(2);
  });

  it("a settled edit POSTs visual-edit and emits an applied instant block", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, _init?: unknown) => Promise.resolve({
      ok: true, json: () => Promise.resolve({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock as any);
    const onSend = vi.fn();
    renderHarness(onSend);
    fireEvent.click(screen.getByText("open1"));
    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
    fireEvent.blur(widthInput); // settled value → debounced deterministic write
    // Advance past the ~350ms debounce and flush the async write.
    await vi.advanceTimersByTimeAsync(400);
    // Deterministic writer was called against /api/visual-edit/<slug>.
    const posted = fetchMock.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/visual-edit/"),
    );
    expect(posted).toBe(true);
    // An applied instant block was emitted; deterministic success does NOT chat.
    const instant = capturedBlocks.find((b) => b.kind === "instant");
    expect(instant).toBeTruthy();
    expect(instant!.status).toBe("applied");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does NOT render a Text input (text is edited in place)", () => {
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open1"));
    expect(screen.queryByLabelText(/text content/i)).toBeNull();
  });

  it("resize handle widens the panel when dragged left", () => {
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open1"));
    const initialWidth = parseInt(screen.getByTestId("width").textContent || "360", 10);
    const handle = screen.getByRole("separator", { name: /resize inspector/i });
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 50 }); // drag left
    const newWidth = parseInt(screen.getByTestId("width").textContent || "360", 10);
    expect(newWidth).toBeGreaterThan(initialWidth);
  });

  it("removing an element sends preview-reset postMessage", () => {
    (stubWindow.postMessage as any).mockClear?.();
    renderHarness(vi.fn());
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
          <InspectorPanel onSend={vi.fn()} busy={false} slug="test-slug" />
        </>
      );
    }

    render(
      <EditSessionProvider>
        <EditBlocksProvider>
          <IconHarness />
        </EditBlocksProvider>
      </EditSessionProvider>,
    );
    fireEvent.click(screen.getByText("open-icon"));
    expect(await screen.findByText("Icon")).toBeTruthy(); // the Section title
    expect(screen.getByRole("button", { name: /replace/i })).toBeTruthy();
  });

  it("disables move buttons while the focused element has staged edits", () => {
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open1"));
    // Initially buttons are enabled
    const upBtn = screen.getByLabelText("Move element up") as HTMLButtonElement;
    const downBtn = screen.getByLabelText("Move element down") as HTMLButtonElement;
    expect(upBtn.disabled).toBe(false);
    expect(downBtn.disabled).toBe(false);
    // Stage an edit — its line:column would shift once the write lands, so moving
    // is blocked until the element is settled/cleared.
    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
    fireEvent.blur(widthInput);
    // Now buttons should be disabled
    expect(upBtn.disabled).toBe(true);
    expect(downBtn.disabled).toBe(true);
    expect(upBtn.title).toMatch(/before moving/i);
  });

  it("keeps the batch intact while move is blocked by staged edits", () => {
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open1"));
    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
    fireEvent.blur(widthInput);
    expect(screen.getByTestId("count").textContent).toBe("1");
    // Move is disabled while there are staged edits — the destructive action
    // (which would clear the selection) can't fire.
    const upBtn = screen.getByLabelText("Move element up") as HTMLButtonElement;
    expect(upBtn.disabled).toBe(true);
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("clears the selection on a successful move", async () => {
    (stubWindow.postMessage as any).mockClear?.();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ ok: true }),
    })) as any);
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open1-with-window"));
    // No staged edits, buttons enabled
    const upBtn = screen.getByLabelText("Move element up") as HTMLButtonElement;
    expect(upBtn.disabled).toBe(false);
    fireEvent.click(upBtn);
    await vi.waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
    expect(stubWindow.postMessage).toHaveBeenCalledWith(
      { type: "arcade-studio:preview-reset", all: true },
      "*",
    );
  });
});
