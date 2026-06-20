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
  ChartLineInSquare: () => null,
  ChevronLeftSmall: () => null,
  ChevronRightSmall: () => null,
  ThreeDotsHorizontal: () => null,
  PlusSmall: () => null,
  ChevronDownSmall: () => null,
  TwoSquaresOverlapping: () => null,
  MagnifyingGlass: () => null,
  InfoInCircle: () => null,
  Clock: () => null,
  Sidebar: () => null,
  Tabs: {
    Root: ({ children }: any) => <div>{children}</div>,
    List: ({ children }: any) => <div>{children}</div>,
    Trigger: ({ children }: any) => <button>{children}</button>,
    Content: ({ children }: any) => <div>{children}</div>,
  },
  Select: {
    Root: ({ children }: any) => <div>{children}</div>,
    Trigger: ({ children }: any) => <div>{children}</div>,
    Value: ({ placeholder }: any) => <span>{placeholder}</span>,
    Content: ({ children }: any) => <div>{children}</div>,
    Item: ({ children }: any) => <div>{children}</div>,
  },
  Switch: () => <input type="checkbox" />,
  Input: ({ defaultValue }: any) => <input defaultValue={defaultValue} />,
  Button: ({ children }: any) => <button>{children}</button>,
  Tag: ({ children }: any) => <span>{children}</span>,
  Link: ({ children }: any) => <a>{children}</a>,
  Avatar: ({ name }: any) => <div>{name}</div>,
  IconButton: ({ children }: any) => <button>{children}</button>,
  Separator: () => <hr />,
}));

vi.mock("arcade-prototypes", () => ({
  SettingsCard: ({ title, children }: any) => <div>{title}{children}</div>,
  SettingsRow: ({ label, description }: any) => <div>{label}{description}</div>,
  SkillCard: ({ title }: any) => <div>{title}</div>,
}));

import ComputerSettingsTemplate from "../../../prototype-kit/template-seeds/computer/settings/index";

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
    expect(screen.getByText(/packaged instructions that tell a model/i)).toBeTruthy();
  });

  it("renders the My Computer settings body by default", () => {
    render(<ComputerSettingsTemplate />);
    expect(screen.getByText(/General settings/i)).toBeTruthy();
  });

  it("renders all nav pages without crashing", () => {
    render(<ComputerSettingsTemplate />);
    const pagesToTest = [
      "Profile",
      "Preferences",
      "My Computer",
      "Workflows & Tools",
      "Skills",
      "Connectors",
      "Organization",
      "Users",
      "Plans & Billing",
      "Usage",
    ];

    pagesToTest.forEach((pageLabel) => {
      // Click the nav button with the page label
      const navButtons = screen.getAllByRole("button");
      const targetButton = navButtons.find((btn) => btn.textContent === pageLabel);
      expect(targetButton).toBeDefined();
      fireEvent.click(targetButton!);
      // Assert the page title appears (verify render succeeded)
      expect(screen.getAllByText(pageLabel).length).toBeGreaterThan(0);
    });
  });
});
