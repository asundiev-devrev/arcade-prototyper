import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { ShareModal } from "../../src/components/shell/ShareModal";
import type { Frame } from "../../server/types";

// arcade-gen is mocked throughout the suite; keep that consistent here.
vi.mock("@xorkavi/arcade-gen", () => ({
  Modal: {
    Root: ({ children, open }: any) => (open ? React.createElement("div", null, children) : null),
    Content: ({ children }: any) => React.createElement("div", null, children),
    Header: ({ children }: any) => React.createElement("div", null, children),
    Title: ({ children }: any) => React.createElement("h2", null, children),
    Description: ({ children }: any) => React.createElement("p", null, children),
    Body: ({ children }: any) => React.createElement("div", null, children),
    Footer: ({ children }: any) => React.createElement("div", null, children),
  },
  Button: ({ children, onClick, disabled, variant }: any) =>
    React.createElement(
      "button",
      { onClick, disabled, "data-variant": variant },
      children,
    ),
}));

afterEach(() => cleanup());

const frames: Frame[] = [
  { slug: "hello", name: "Hello", size: "1440", createdAt: new Date().toISOString() },
];

describe("ShareModal — Copy Lift Manifest", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        `<lift_manifest schema_version="1" project="demo" frame="hello" shape="ad-hoc"></lift_manifest>`,
    }) as any;
  });

  it("renders a Copy Lift Manifest button when a frame is selected", () => {
    render(<ShareModal open={true} onClose={() => {}} projectSlug="demo" frames={frames} />);
    fireEvent.click(screen.getByRole("radio", { name: /Hello/ }));
    // toBeInTheDocument isn't loaded; use a plain assertion.
    expect(screen.getByRole("button", { name: /Copy Lift Manifest/i })).toBeTruthy();
  });

  it("fetches the XML manifest and writes a paste-ready prompt to clipboard", async () => {
    render(<ShareModal open={true} onClose={() => {}} projectSlug="demo" frames={frames} />);
    fireEvent.click(screen.getByRole("radio", { name: /Hello/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copy Lift Manifest/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/projects/demo/lift/hello.xml");
      const [clipboardArg] = (navigator.clipboard.writeText as any).mock.calls[0];
      // The raw manifest is still in the payload...
      expect(clipboardArg).toContain(`<lift_manifest`);
      expect(clipboardArg).toContain(`project="demo"`);
      expect(clipboardArg).toContain(`frame="hello"`);
      // ...but now wrapped in a prompt (0.16.1).
      expect(clipboardArg).toContain("lift an Arcade Studio frame");
      expect(clipboardArg).toContain("```xml");
      expect(clipboardArg).toContain("tmp/lift/hello.tsx");
    });
  });
});
