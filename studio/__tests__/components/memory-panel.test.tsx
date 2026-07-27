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
  IconButton: ({ onClick, "aria-label": label, children }: any) => (
    <button onClick={onClick} aria-label={label}>{children}</button>
  ),
  Input: (p: any) => <input {...p} />,
  Badge: ({ children }: any) => <span>{children}</span>,
  TextArea: (p: any) => <textarea {...p} />,
  // Icons. The real kit exports these (verified against dist/index.d.mts);
  // rendering them as marker spans lets a test assert an icon is PRESENT —
  // the iconless-IconButton bug shipped precisely because the old mock
  // swallowed children.
  Globe: () => <span data-icon="globe" />,
  Pin: () => <span data-icon="pin" />,
  PinFilled: () => <span data-icon="pin-filled" />,
  TrashBin: () => <span data-icon="trash" />,
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
  // Structured — the server sends data, never the agent's raw INVENTORY.md.
  inventory: {
    frames: [{ slug: "01-list", components: ["VistaPage", "Checkbox"] }],
    composites: ["SkillCardAndrey"],
  },
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

  it("shows the repeat count for a row", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/3×/));
  });

  it("gives every row action a visible icon", async () => {
    // Regression: IconButton requires an icon as `children`. Shipping it with
    // none rendered three blank circles in the panel, and the old mock hid it
    // by discarding children.
    render(<MemoryPanel projectSlug="demo" />);
    const forget = await waitFor(() =>
      screen.getByLabelText("Forget: Neutral gray for active nav rows"),
    );
    expect(forget.querySelector("[data-icon]")).not.toBeNull();
    expect(
      screen.getByLabelText("Limit to this project: Neutral gray for active nav rows")
        .querySelector("[data-icon]"),
    ).not.toBeNull();
    expect(
      screen.getByLabelText("Pin: Neutral gray for active nav rows").querySelector("[data-icon]"),
    ).not.toBeNull();
  });

  it("renders the inventory as frame rows, never as raw markdown", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText("01-list"));
    // The agent's INVENTORY.md uses markdown headings and dumps every visible
    // string in the frame. None of that belongs in front of a designer.
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("## Frames");
    expect(body).not.toContain("visible text:");
    expect(body).not.toContain("components used:");
    expect(screen.getByText(/VistaPage/)).toBeTruthy();
    expect(screen.getByText(/SkillCardAndrey/)).toBeTruthy();
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
            inventory: { frames: [], composites: [] },
          }),
      } as any),
    );
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => {
      expect(screen.getByText(/hasn't learned anything about your work yet/)).toBeTruthy();
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
