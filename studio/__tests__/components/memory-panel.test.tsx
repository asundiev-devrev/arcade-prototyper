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
  // The kit TextArea renders its own <label> from the `label` prop.
  TextArea: ({ label, ...p }: any) => (
    <label>
      {label}
      <textarea {...p} />
    </label>
  ),
  // Icons. The real kit exports these (verified against dist/index.d.mts);
  // rendering them as marker spans lets a test assert an icon is PRESENT —
  // the iconless-IconButton bug shipped precisely because the old mock
  // swallowed children.
  TrashBin: (p: any) => <span data-icon="trash" data-size={p?.size} />,
  Tag: ({ children }: any) => <span>{children}</span>,
  // Tooltip wraps a single trigger element and must render it through.
  Tooltip: ({ children }: any) => children,
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
  it("says what the panel is for", async () => {
    // The "what am I looking at?" failure: a list of facts with no stated purpose.
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/What Studio knows/));
    expect(screen.getByText(/Applied to every frame it generates/)).toBeTruthy();
  });

  it("groups by source, not scope, and labels each fact's reach", async () => {
    // Two identical "Rules you set" headings (one per scope) was unreadable.
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Neutral gray for active nav rows/));
    expect(screen.getByText("Your instructions")).toBeTruthy();
    expect(screen.getByText("Picked up from your edits")).toBeTruthy();
    expect(screen.getAllByText("Every project").length).toBeGreaterThan(0);
    expect(screen.getAllByText("This project").length).toBeGreaterThan(0);
  });

  it("renders the designer's rules", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Never use emoji in UI copy/));
  });

  it("spells out the repeat count instead of a bare glyph", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/came up 3 times/));
  });

  it("offers one action per inferred fact, with a visible icon", async () => {
    // Pin and re-scope were noise on every row; remove is the action the
    // section exists for. IconButton needs the icon as `children` — shipping it
    // without one rendered a blank circle.
    render(<MemoryPanel projectSlug="demo" />);
    const remove = await waitFor(() =>
      screen.getByLabelText("Remove: Neutral gray for active nav rows"),
    );
    expect(remove.querySelector("[data-icon]")).not.toBeNull();
    expect(screen.queryByLabelText(/^Pin:/)).toBeNull();
    expect(screen.queryByLabelText(/^Apply everywhere:/)).toBeNull();
    expect(screen.queryByLabelText(/^Limit to this project:/)).toBeNull();
  });

  it("labels each instruction field with the kit label", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText("For every project"));
    expect(screen.getByText("For this project only")).toBeTruthy();
  });

  it("gives the instruction fields room for several lines", async () => {
    // A 2-row box read as a single-line input for multi-sentence rules.
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText("For every project"));
    for (const ta of Array.from(document.querySelectorAll("textarea"))) {
      expect(Number(ta.getAttribute("rows"))).toBeGreaterThanOrEqual(3);
    }
  });

  it("does not show the project inventory", async () => {
    // The frame/composite list still reaches the AGENT via memory/INVENTORY.md,
    // but the designer can't act on it, so it has no place in this panel.
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Neutral gray/));
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("01-list");
    expect(body).not.toContain("SkillCardAndrey");
    // And never the agent's raw markdown, under any circumstances.
    expect(body).not.toContain("## Frames");
    expect(body).not.toContain("visible text:");
  });

  it("sizes every action icon (an unsized icon renders huge)", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Neutral gray/));
    for (const icon of Array.from(document.querySelectorAll("[data-icon]"))) {
      expect(icon.getAttribute("data-size")).toBe("16");
    }
  });

  it("deletes a row through the API", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Neutral gray/));
    await userEvent.click(screen.getByLabelText("Remove: Neutral gray for active nav rows"));
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
      // Empty states must say what to expect, not just be blank.
      expect(screen.getByText(/Nothing yet\./)).toBeTruthy();
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
    await userEvent.click(screen.getByLabelText("Remove: Neutral gray for active nav rows"));
    await waitFor(() => expect(screen.getByText(/couldn't/i)).toBeTruthy());
  });

  it("does not show a mutation error on the happy path", async () => {
    render(<MemoryPanel projectSlug="demo" />);
    await waitFor(() => screen.getByText(/Neutral gray/));
    await userEvent.click(screen.getByLabelText("Remove: Neutral gray for active nav rows"));
    await waitFor(() => {
      expect(screen.queryByText(/couldn't/i)).toBeNull();
    });
  });
});
