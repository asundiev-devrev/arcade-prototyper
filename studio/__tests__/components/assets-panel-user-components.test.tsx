import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AssetsPanel } from "../../src/components/assets/AssetsPanel";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/assets") return new Response(JSON.stringify({ sections: [
      { kind: "composite", items: [{ name: "EntityCard", doc: "card", thumb: null }] },
      { kind: "component", items: [{ name: "Button", doc: "btn", thumb: null }] },
      { kind: "icon", items: [] },
    ] }), { status: 200 });
    if (url === "/api/components") return new Response(JSON.stringify({ components: [
      { name: "PriceTag", description: "A price tag", createdAt: "2026-06-22T00:00:00Z", origin: "saved" },
    ] }), { status: 200 });
    return new Response("{}", { status: 200 });
  }));
});

describe("AssetsPanel user components", () => {
  it("shows the Your components section and relabeled sections", async () => {
    const { container } = render(<AssetsPanel onSeed={() => {}} onSeeded={() => {}} />);
    await waitFor(() => expect(screen.getAllByText(/PriceTag/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Your components/i)).toBeTruthy();
    expect(screen.getByText(/^Components/)).toBeTruthy(); // relabeled composites
    expect(screen.getByText(/^Elements/)).toBeTruthy();   // relabeled components
    expect(screen.queryByText(/Composites/)).toBeFalsy(); // no "composite" word
  });
});
