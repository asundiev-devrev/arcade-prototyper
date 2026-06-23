// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick }: any) => React.createElement("button", { onClick }, children),
  // AssetsPanel calls useToast() for import/export feedback; stub it so the
  // component renders without a real ToastProvider in the test tree.
  useToast: () => ({ toast: vi.fn() }),
}));

import { AssetsPanel } from "../../src/components/assets/AssetsPanel";

const CATALOG = {
  sections: [
    { kind: "composite", items: [{ name: "FormModal", doc: "Edit dialog.", thumb: "assets-thumbs/FormModal.png" }] },
    { kind: "component", items: [{ name: "Button", doc: "Action control.", thumb: "assets-thumbs/Button.png" }] },
    { kind: "icon", items: [{ name: "ChevronDown", category: "Navigation", tags: ["chevron"], svg: "<svg></svg>" }] },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(CATALOG) })) as any);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AssetsPanel", () => {
  it("renders all three sections after load", async () => {
    render(<AssetsPanel onSeed={vi.fn()} onSeeded={vi.fn()} />);
    expect(await screen.findByText("FormModal")).toBeTruthy();
    expect(screen.getByText("Button")).toBeTruthy();
    expect(screen.getByText("ChevronDown")).toBeTruthy();
  });

  it("filters by search query", async () => {
    render(<AssetsPanel onSeed={vi.fn()} onSeeded={vi.fn()} />);
    await screen.findByText("FormModal");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "button" } });
    expect(screen.queryByText("FormModal")).toBeNull();
    expect(screen.getByText("Button")).toBeTruthy();
  });

  it("seeds a kind-aware prompt and requests tab switch on Use this", async () => {
    const onSeed = vi.fn();
    const onSeeded = vi.fn();
    render(<AssetsPanel onSeed={onSeed} onSeeded={onSeeded} />);
    fireEvent.click(await screen.findByText("FormModal"));
    fireEvent.click(await screen.findByRole("button", { name: /use this/i }));
    expect(onSeed).toHaveBeenCalledWith("Use the FormModal composite to ");
    expect(onSeeded).toHaveBeenCalled();
  });

  it("copies icon name on click", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } } as any);
    render(<AssetsPanel onSeed={vi.fn()} onSeeded={vi.fn()} />);
    fireEvent.click(await screen.findByText("ChevronDown"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ChevronDown"));
  });
});
