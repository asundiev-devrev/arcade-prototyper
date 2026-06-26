// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
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
// Element authored inside frame "home" — so it routes through the field-edit
// (instant-apply) path, not the off-frame Customize path.
function sel(editId: number, iconCandidate?: string): ElementSelection {
  return {
    editId, file: "/p/frames/home/index.tsx", line: editId, column: 1,
    componentName: "Button", tagName: "button", textEditable: true, styles: STYLES,
    ownerChain: [],
    ...(iconCandidate ? { iconCandidate } : {}),
  };
}

// Probe component reads the blocks out of context so the test can assert kind/status.
let capturedBlocks: EditBlock[] = [];
function BlocksProbe() {
  const { blocks } = useEditBlocks();
  capturedBlocks = blocks;
  return <span data-testid="block-count">{blocks.length}</span>;
}

function Harness({ onSend }: { onSend: any }) {
  const ctx = useEditSession();
  return (
    <>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(sel(1), "home", null); }}>open1</button>
      <InspectorPanel onSend={onSend} busy={false} slug="test-slug" />
      <BlocksProbe />
      <span data-testid="focused">{ctx.focusedEditId ?? ""}</span>
    </>
  );
}

function renderHarness(onSend: any) {
  return render(
    <EditSessionProvider>
      <EditBlocksProvider>
        <Harness onSend={onSend} />
      </EditBlocksProvider>
    </EditSessionProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  capturedBlocks = [];
});

describe("inspector instant-apply model", () => {
  it("renders NO Commit button", () => {
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open1"));
    // The whole point of the rewrite: there is no Commit affordance anymore.
    expect(screen.queryByText(/Commit/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /commit/i })).toBeNull();
  });

  it("a deterministic edit POSTs visual-edit and creates an applied instant block", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, _init?: unknown) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock as any);

    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open1"));

    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
    fireEvent.blur(widthInput); // settled value → schedule deterministic apply

    // Advance past the debounce window (~350ms), then flush the async write.
    await vi.advanceTimersByTimeAsync(400);

    // POSTed to /api/visual-edit/<slug>
    const calledVisualEdit = fetchMock.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/visual-edit/"),
    );
    expect(calledVisualEdit).toBe(true);

    // An instant/applied block was emitted.
    const instant = capturedBlocks.find((b) => b.kind === "instant");
    expect(instant).toBeTruthy();
    expect(instant!.status).toBe("applied");
    expect(instant!.frameSlug).toBe("home");
  });

  it("a deterministic bail creates a pending ai block and does NOT onSend", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: false, reason: "dynamic-classname" }),
    }));
    vi.stubGlobal("fetch", fetchMock as any);
    const onSend = vi.fn();

    renderHarness(onSend);
    fireEvent.click(screen.getByText("open1"));

    const widthInput = screen.getByLabelText("W") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "100" } });
    fireEvent.blur(widthInput);

    await vi.advanceTimersByTimeAsync(400);

    // The deterministic writer bailed → a pending AI block, NOT auto-sent.
    const ai = capturedBlocks.find((b) => b.kind === "ai");
    expect(ai).toBeTruthy();
    expect(ai!.status).toBe("pending");
    expect(onSend).not.toHaveBeenCalled();
  });
});
