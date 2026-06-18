import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// The seed imports from "arcade/components" (alias) — mock it with explicit exports.
vi.mock("arcade/components", () => ({
  HumanSilhouette: () => null,
  ArrowsLeftAndRight: () => null,
  Computer: () => null,
  ThreeBarsHorizontal: () => null,
  LightingBolt: () => null,
  Mcp: () => null,
  Buildings: () => null,
  TwoHumanSilhouettes: () => null,
  CreditCard: () => null,
  Dashboard: () => null,
  ChevronLeftSmall: () => null,
  Sidebar: () => null,
}));

import ComputerSettingsTemplate from "../../../prototype-kit/template-seeds/computer-settings/index";

afterEach(() => cleanup());

describe("Computer: Settings shell", () => {
  it("defaults to My Computer and switches page on nav click", () => {
    render(<ComputerSettingsTemplate />);
    // default title visible
    expect(screen.getAllByText("My Computer").length).toBeGreaterThan(0);
    // click the Skills nav item → Skills becomes the page title
    fireEvent.click(screen.getByText("Skills"));
    expect(screen.getAllByText("Skills").length).toBeGreaterThan(0);
    // breadcrumb/title now shows Skills subtitle
    expect(screen.getByText(/Discover and add capabilities/i)).toBeTruthy();
  });
});
