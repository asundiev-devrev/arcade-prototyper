import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock @xorkavi/arcade-gen to avoid gridstack ESM resolution issues
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const Modal: any = {
    Root: ({ children, open }: any) => (open ? React.createElement("div", null, children) : null),
    Content: ({ children }: any) => React.createElement("div", null, children),
    Header: ({ children }: any) => React.createElement("div", null, children),
    Title: ({ children }: any) => React.createElement("h2", null, children),
    Description: ({ children }: any) => React.createElement("p", null, children),
    Body: ({ children }: any) => React.createElement("div", null, children),
    Footer: ({ children }: any) => React.createElement("div", null, children),
    Close: ({ children }: any) => children,
  };
  return {
    Modal,
    Button: ({ children, onClick, disabled, ...rest }: any) =>
      React.createElement("button", { onClick, disabled, ...rest }, children),
    Input: React.forwardRef((props: any, ref: any) =>
      React.createElement("input", { ...props, ref }),
    ),
    IconButton: ({ children, onClick, "aria-label": ariaLabel }: any) =>
      React.createElement("button", { onClick, "aria-label": ariaLabel }, children),
    CrossSmall: () => React.createElement("span", null, "×"),
  };
});

// Thumbnail capture is a post-save UI side-effect (renders the component in a
// hidden iframe + rasterizes) — not the modal's contract and unrunnable in
// jsdom. Stub it so the save path resolves deterministically.
vi.mock("../../src/components/assets/captureComponentThumb", () => ({
  captureComponentThumb: vi.fn(async () => true),
}));

import { SaveComponentModal } from "../../src/components/assets/SaveComponentModal";

const target = { file: "/x/frames/01-home/index.tsx", line: 5, column: 3, componentName: "Card", tagName: "div", frameSlug: "01-home" };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SaveComponentModal", () => {
  it("prefills the name and posts a save", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ saved: true, name: "Card" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<SaveComponentModal target={target as any} projectSlug="demo" onClose={() => {}} onSaved={onSaved} />);
    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Card");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Card"));
    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse((opts as any).body)).toMatchObject({ projectSlug: "demo", frameSlug: "01-home", line: 5, column: 3, name: "Card" });
  });

  it("blocks an invalid name", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SaveComponentModal target={target as any} projectSlug="demo" onClose={() => {}} onSaved={() => {}} />);

    // Clear and type an invalid name (lowercase start)
    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "invalidname");

    // Wait for state to settle and verify button is disabled (blocks submission)
    await waitFor(() => {
      const saveButton = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
      expect(saveButton.disabled).toBe(true);
    });

    // Verify NO POST was made (button disabled = no submission possible)
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
