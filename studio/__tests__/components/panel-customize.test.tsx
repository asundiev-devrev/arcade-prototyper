// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, disabled, variant }: any) =>
    React.createElement("button", { onClick, disabled, "data-variant": variant }, children),
  useToast: () => ({ toast: () => "toast-id", dismiss: () => {} }),
}));

// Mock the customize network/serialize seam. markJsxRoot, newCustomizeToken and
// buildCustomizePayload run REAL so the asserted marker is produced by the real
// code path; only the live-iframe serialize + the POST are stubbed.
const postCustomizeMock = vi.fn(async (_slug: string, _payload: { jsx: string }) => ({ ok: true as const }));
vi.mock("../../src/lib/customizeClient", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/customizeClient")>(
    "../../src/lib/customizeClient",
  );
  return {
    ...actual,
    serializeTargetToJsx: () => "<div>x</div>",
    postCustomize: (slug: string, payload: { jsx: string }) => postCustomizeMock(slug, payload),
  };
});

import { InspectorPanel } from "../../src/components/inspector/InspectorPanel";
import {
  EditSessionProvider, useEditSession,
  type ElementSelection, type StyleSnapshot,
} from "../../src/hooks/editSessionContext";
import { EditBlocksProvider } from "../../src/hooks/editBlocksContext";

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

// A COMPONENT selection: file lives OUTSIDE the frame (a shared prototype-kit
// path) → !isInFrame → component mode. ownerChain carries one in-frame anchor
// so resolveCustomizeTarget returns a real target for the runCustomize path.
function componentSel(): ElementSelection {
  return {
    editId: 1, file: "/p/studio/prototype-kit/x.tsx", line: 5, column: 3,
    componentName: "ComputerScene", tagName: "div", textEditable: false, styles: STYLES,
    ownerChain: [
      { componentName: "ComputerScene", file: "/p/projects/demo/frames/home/index.tsx", line: 4, column: 6 },
    ],
  };
}

// An IN-FRAME selection: file under /frames/<slug>/ → isInFrame → fields live.
function inFrameSel(): ElementSelection {
  return {
    editId: 2, file: "/p/projects/demo/frames/home/index.tsx", line: 10, column: 1,
    componentName: "button", tagName: "button", textEditable: true, styles: STYLES,
    ownerChain: [],
  };
}

// frameWindow stub: runCustomize reads `frameWindow.frameElement` to get the
// live iframe. serializeTargetToJsx is mocked so the element just needs to be
// truthy.
const stubWindow = {
  postMessage: vi.fn(),
  frameElement: document.createElement("iframe"),
} as unknown as Window;

function Harness() {
  const ctx = useEditSession();
  return (
    <>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(componentSel(), "home", stubWindow); }}>open-component</button>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(inFrameSel(), "home", stubWindow); }}>open-inframe</button>
      <InspectorPanel onSend={vi.fn()} busy={false} slug="demo" />
    </>
  );
}

function renderHarness() {
  return render(
    <EditSessionProvider>
      <EditBlocksProvider>
        <Harness />
      </EditBlocksProvider>
    </EditSessionProvider>,
  );
}

beforeEach(() => {
  postCustomizeMock.mockClear();
  postCustomizeMock.mockResolvedValue({ ok: true });
  // kit-props fetch + any other network the panel pokes.
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ ok: true, props: [] }),
  })) as any);
  // useDialogs falls back to native window.confirm when no DialogsProvider is
  // mounted (this harness mounts none) — stub it to confirm.
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("panel customize", () => {
  it("shows a Customize button for a component selection and grays the field sections", () => {
    renderHarness();
    fireEvent.click(screen.getByText("open-component"));
    // (a) component mode → a Customize button exists.
    const customize = screen.getByText("Customize");
    expect(customize).toBeTruthy();
    // …and the style sections are grayed (pointerEvents:none → no edit can fire).
    const layout = screen.getByText("Layout");
    // Walk up to the grayed wrapper that holds all the style sections.
    let node: HTMLElement | null = layout;
    let grayed = false;
    while (node) {
      if (node.style && node.style.pointerEvents === "none") { grayed = true; break; }
      node = node.parentElement;
    }
    expect(grayed).toBe(true);
  });

  it("does not show Customize for an in-frame element and keeps fields live", () => {
    renderHarness();
    fireEvent.click(screen.getByText("open-inframe"));
    // (b) in-frame → no Customize button; the width field is editable.
    expect(screen.queryByText("Customize")).toBeNull();
    const width = screen.getByLabelText("W") as HTMLInputElement;
    // Live: the wrapper around Layout must NOT be pointerEvents:none.
    let node: HTMLElement | null = width;
    let grayed = false;
    while (node) {
      if (node.style && node.style.pointerEvents === "none") { grayed = true; break; }
      node = node.parentElement;
    }
    expect(grayed).toBe(false);
  });

  it("clicking Customize confirms then posts a marked-jsx payload", async () => {
    renderHarness();
    fireEvent.click(screen.getByText("open-component"));
    fireEvent.click(screen.getByText("Customize"));
    await waitFor(() => expect(postCustomizeMock).toHaveBeenCalled());
    // (c) confirm fired, and the posted payload's jsx carries the marker the real
    // markJsxRoot inserted.
    expect(window.confirm).toHaveBeenCalled();
    const payload = postCustomizeMock.mock.calls[0]![1];
    expect(payload.jsx).toContain("data-arcade-customized");
  });
});
