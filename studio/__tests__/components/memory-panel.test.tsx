// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryPanel } from "../../src/components/memory/MemoryPanel";

// The kit is mocked in component tests (see studio/CLAUDE.md "Test discipline").
// Every arcade-gen export MemoryPanel uses must appear here.
vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, ...p }: any) => (
    <button onClick={onClick} {...p}>{children}</button>
  ),
  IconButton: ({ onClick, "aria-label": label }: any) => (
    <button onClick={onClick} aria-label={label} />
  ),
  Input: (p: any) => <input {...p} />,
  Badge: ({ children }: any) => <span>{children}</span>,
  TextArea: (p: any) => <textarea {...p} />,
}));

const SNAPSHOT = {
  global: {
    rows: [
      { id: "g1", fact: "Neutral gray for active nav rows", level: "global", hits: 3 },
    ],
    rules: "Never use emoji in UI copy",
  },
  project: {
    rows: [{ id: "p1", fact: "Filter chips go in the toolbar", level: "project", hits: 2 }],
    rules: "",
  },
  inventory: "## Frames already in this project\n\n### frame: 01-list",
};

beforeEach(() => {
  global.fetch = vi.fn((url: any, init?: any) => {
    const u = String(url);
    if (u.startsWith("/api/memory?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(SNAPSHOT) } as any);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as any);
  }) as any;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MemoryPanel", () => {
  it("shows global memories above project memories", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Neutral gray for active nav rows/));
    const body = document.body.textContent ?? "";
    expect(body.indexOf("Neutral gray")).toBeLessThan(body.indexOf("Filter chips"));
  });

  it("renders the designer's rules and the project inventory", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Never use emoji in UI copy/));
    expect(screen.getByText(/01-list/)).toBeTruthy();
  });

  it("shows the hit count for a row", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/×3/));
  });

  it("deletes a row through the API", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Neutral gray/));
    await userEvent.click(screen.getByLabelText("Forget: Neutral gray for active nav rows"));
    await waitFor(() => {
      const calls = (global.fetch as any).mock.calls.map((c: any[]) => [String(c[0]), c[1]?.method]);
      expect(calls).toEqual(
        expect.arrayContaining([["/api/memory/row", "DELETE"]]),
      );
    });
  });

  it("renders an empty state when nothing is known yet", async () => {
    (global.fetch as any).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            global: { rows: [], rules: "" },
            project: { rows: [], rules: "" },
            inventory: "",
          }),
      } as any),
    );
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => {
      expect(screen.getByText(/Studio hasn't learned anything yet/)).toBeTruthy();
    });
  });

  it("surfaces an error state rather than rendering nothing", async () => {
    (global.fetch as any).mockImplementation(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as any),
    );
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/couldn't load/i));
  });

  it("tells the designer when a change could not be saved", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Neutral gray/));
    // GET keeps working; the mutation is what fails.
    (global.fetch as any).mockImplementation((url: any, init?: any) => {
      if (String(url).startsWith("/api/memory?")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(SNAPSHOT) } as any);
      }
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as any);
    });
    await userEvent.click(screen.getByLabelText("Forget: Neutral gray for active nav rows"));
    await waitFor(() => expect(screen.getByText(/couldn't/i)).toBeTruthy());
  });

  it("does not show a mutation error on the happy path", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Neutral gray/));
    await userEvent.click(screen.getByLabelText("Forget: Neutral gray for active nav rows"));
    await waitFor(() => {
      expect(screen.queryByText(/couldn't/i)).toBeNull();
    });
  });
});
