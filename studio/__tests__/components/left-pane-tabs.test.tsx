// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeftPaneTabToggle } from "../../src/components/shell/LeftPaneTabToggle";

vi.mock("@xorkavi/arcade-gen", () => ({
  SegmentedControl: {
    Root: ({ children, "aria-label": label }: any) => <div aria-label={label}>{children}</div>,
    Item: ({ children, value }: any) => <button value={value}>{children}</button>,
  },
}));

describe("LeftPaneTabToggle", () => {
  it("offers Chat, Assets and Memory", () => {
    render(<LeftPaneTabToggle tab="chat" onTabChange={() => {}} />);
    expect(screen.getByText("Chat")).toBeTruthy();
    expect(screen.getByText("Assets")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
  });
});
