// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Mirror the InspectorPanel.test.tsx mock — variant is forwarded so the
// "Ask AI to change this" primary button is a real <button>.
vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, disabled, variant }: any) =>
    React.createElement("button", { onClick, disabled, "data-variant": variant }, children),
  useToast: () => ({ toast: () => {}, dismiss: () => {} }),
}));

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

// A COMPONENT selection: the clicked element's `file` is a shared prototype-kit
// path (NOT under /frames/<slug>/) → !isInFrame → component mode. ownerChain's
// innermost in-frame link is <SettingsPage> authored in this frame's index.tsx
// at line 7 col 25 — that is the resolved component whose props we edit.
function componentSel(): ElementSelection {
  return {
    editId: 1, file: "/p/studio/prototype-kit/Grid.tsx", line: 5, column: 3,
    componentName: "Grid", tagName: "div", textEditable: false, styles: STYLES,
    ownerChain: [
      { componentName: "SettingsPage", file: "/p/projects/demo/frames/home/index.tsx", line: 7, column: 25 },
    ],
  };
}

const stubWindow = { postMessage: vi.fn() } as unknown as Window;

function Harness({ onSend }: { onSend: any }) {
  const ctx = useEditSession();
  return (
    <>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(componentSel(), "home", stubWindow); }}>open-component</button>
      <InspectorPanel onSend={onSend} busy={false} slug="demo" />
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

// Per-test override of the kit-props payload. Default: the "columns" prop set.
// Updated to KitProp2 shape (Task 5): kind + optional values/default.
let kitPropsPayload: { props: { name: string; kind: "text" | "toggle" | "number" | "select"; values?: string[]; default?: string }[] } = {
  props: [{ name: "columns", kind: "select", values: ["2", "3", "4"] }],
};

beforeEach(() => {
  // fetch serves /api/kit-props (returns kitPropsPayload), /api/instance-props
  // (returns empty attrs), and /api/visual-edit (returns {ok:true}). Tests that
  // assert on the POST inspect this same mock.
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (typeof url === "string" && url.startsWith("/api/kit-props/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(kitPropsPayload) });
    }
    if (typeof url === "string" && url.startsWith("/api/instance-props/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ attrs: {} }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  }) as any);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  kitPropsPayload = { props: [{ name: "columns", kind: "select", values: ["2", "3", "4"] }] };
});

describe("panel props-first", () => {
  it("shows 'Editing <Name>' + prop dropdowns + Ask AI, NO Customize", async () => {
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open-component"));
    // Header names the RESOLVED in-frame component, not the clicked Grid.
    expect(await screen.findByText("Editing <SettingsPage>")).toBeTruthy();
    // The editable prop dropdown for "columns" is present.
    const columns = screen.getByLabelText("columns") as HTMLSelectElement;
    expect(columns).toBeTruthy();
    expect(columns.disabled).toBe(false);
    // The Ask AI affordance is present; the old Customize button is gone.
    expect(screen.getByText("Ask AI to change this")).toBeTruthy();
    expect(screen.queryByText("Customize")).toBeNull();
  });

  it("changing a prop posts visual-edit for the resolved in-frame component", async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (typeof url === "string" && url.startsWith("/api/kit-props/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(kitPropsPayload) });
      }
      if (typeof url === "string" && url.startsWith("/api/instance-props/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ attrs: {} }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock as any);

    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open-component"));
    const columns = await screen.findByLabelText("columns") as HTMLSelectElement;
    fireEvent.change(columns, { target: { value: "3" } });

    // A /api/visual-edit POST landed.
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].startsWith("/api/visual-edit/"),
      );
      expect(call).toBeTruthy();
    });
    const call = fetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/visual-edit/"),
    )!;
    const body = JSON.parse(call[1]!.body as string);
    const edit = body.edits[0];
    // Targets the RESOLVED SettingsPage file/line/col, NOT the clicked Grid's kit path.
    // CRITICAL: edit.file must be the frame's index.tsx (under /frames/<slug>/) so the
    // server's slug derivation regex `/\/projects\/([^/]+)\/frames\//` succeeds.
    expect(edit.file).toContain("/frames/home/");
    expect(edit.line).toBe(7);
    expect(edit.column).toBe(25);
    // Writes prop:columns = "3".
    expect(edit.fields).toContainEqual({ field: "prop:columns", value: "3" });
  });

  it("Ask AI to change this sends a scoped onSend naming the component", async () => {
    const onSend = vi.fn();
    renderHarness(onSend);
    fireEvent.click(screen.getByText("open-component"));
    await screen.findByText("Editing <SettingsPage>");
    fireEvent.click(screen.getByText("Ask AI to change this"));
    expect(onSend).toHaveBeenCalledTimes(1);
    const prompt = onSend.mock.calls[0]![0] as string;
    expect(prompt).toContain("SettingsPage");
  });

  it("no kitProps → shows the no-properties note + Ask AI, no dropdowns", async () => {
    kitPropsPayload = { props: [] };
    renderHarness(vi.fn());
    fireEvent.click(screen.getByText("open-component"));
    expect(await screen.findByText("Editing <SettingsPage>")).toBeTruthy();
    expect(screen.getByText("No editable properties — use Ask AI to change this.")).toBeTruthy();
    expect(screen.getByText("Ask AI to change this")).toBeTruthy();
    // No prop dropdowns at all.
    expect(screen.queryByLabelText("columns")).toBeNull();
  });
});
