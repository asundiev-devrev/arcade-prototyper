// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FigmaConnectButton } from "../../src/components/shell/FigmaConnectButton";

// Mock the arcade-gen exports used by FigmaConnectButton to avoid
// gridstack import issues. Modal is only rendered when `open` is true,
// so render its children inline in that case; otherwise render nothing.
vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
  Input: ({ value, onChange, ...props }: any) => (
    <input value={value} onChange={onChange} {...props} />
  ),
  Modal: {
    Root: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
    Content: ({ children }: any) => <div>{children}</div>,
    Header: ({ children }: any) => <div>{children}</div>,
    Title: ({ children }: any) => <h2>{children}</h2>,
    Description: ({ children }: any) => <p>{children}</p>,
    Body: ({ children }: any) => <div>{children}</div>,
    Footer: ({ children }: any) => <div>{children}</div>,
  },
}));

describe("FigmaConnectButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows 'Connect Figma' when unauthenticated", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authenticated: false }),
    }) as any;
    render(<FigmaConnectButton />);
    await waitFor(() => expect(screen.getByText(/Connect Figma/i)).toBeTruthy());
  });

  it("shows connected user email when authenticated", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authenticated: true, user: { email: "test@example.com" } }),
    }) as any;
    render(<FigmaConnectButton />);
    await waitFor(() => expect(screen.getByText(/test@example.com/)).toBeTruthy());
  });
});
