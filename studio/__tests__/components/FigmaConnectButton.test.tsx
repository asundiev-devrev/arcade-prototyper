// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FigmaConnectButton } from "../../src/components/shell/FigmaConnectButton";

// Mock the arcade-gen Button to avoid gridstack import issues
vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
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
