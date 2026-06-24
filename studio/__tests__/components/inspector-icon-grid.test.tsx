// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { IconGridPopover } from "../../src/components/inspector/IconGridPopover";
afterEach(cleanup);
const ICONS = [
  { name: "Bell", svg: "<svg></svg>", tags: ["notify"] },
  { name: "Star", svg: "<svg></svg>", tags: ["fav"] },
];
describe("IconGridPopover", () => {
  it("renders all icons and emits the picked name", () => {
    const onPick = vi.fn();
    render(<IconGridPopover icons={ICONS} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(onPick).toHaveBeenCalledWith("Star");
  });
  it("filters by name or tag", () => {
    render(<IconGridPopover icons={ICONS} onPick={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "notify" } });
    expect(screen.getByRole("button", { name: "Bell" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Star" })).toBeNull();
  });
});
