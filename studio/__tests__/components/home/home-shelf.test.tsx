import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Project } from "../../../server/types";

// Mock arcade-gen: HomeShelf uses ToggleGroup; ProjectsSection (rendered as a
// child) uses IconButton + Menu + ThreeDotsHorizontal. Mock all of them.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const ToggleGroup: any = { Root: ({ children }: any) => React.createElement("div", null, children), Item: ({ children, value, onClick }: any) => React.createElement("button", { onClick, "data-value": value }, children) };
  const Menu: any = ({ children }: any) => React.createElement("div", null, children);
  Menu.Root = ({ children }: any) => React.createElement("div", null, children);
  Menu.Trigger = ({ children }: any) => React.createElement("div", null, children);
  Menu.Content = ({ children }: any) => React.createElement("div", null, children);
  Menu.Item = ({ children, onSelect }: any) => React.createElement("button", { onClick: onSelect }, children);
  return {
    ToggleGroup,
    Menu,
    IconButton: React.forwardRef((p: any, ref: any) => React.createElement("button", { ...p, ref })),
    ThreeDotsHorizontal: () => null,
  };
});

// TemplatesSection fetches the manifest; stub fetch so it renders nothing noisy.
vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [] } as Response)));

import { HomeShelf } from "../../../src/components/home/HomeShelf";

afterEach(() => cleanup());

const noop = () => {};
const proj: Project = { name: "Demo", slug: "demo", createdAt: "", updatedAt: "", theme: "arcade", mode: "light", frames: [], chimeIns: [] };

describe("HomeShelf smart default tab", () => {
  it("defaults to Templates when there are no projects", () => {
    render(<HomeShelf projects={[]} onOpen={noop} onRename={noop} onDelete={noop} onStartTemplate={noop} />);
    // Projects grid is empty AND not the active tab → the project name never appears.
    expect(screen.queryByText("Demo")).toBeNull();
  });

  it("defaults to My projects when at least one project exists", () => {
    render(<HomeShelf projects={[proj]} onOpen={noop} onRename={noop} onDelete={noop} onStartTemplate={noop} />);
    expect(screen.getByText("Demo")).toBeTruthy();
  });

  it("flips to My projects when projects arrive after mount (async load)", () => {
    const { rerender } = render(<HomeShelf projects={[]} onOpen={noop} onRename={noop} onDelete={noop} onStartTemplate={noop} />);
    expect(screen.queryByText("Demo")).toBeNull();           // started on Templates
    rerender(<HomeShelf projects={[proj]} onOpen={noop} onRename={noop} onDelete={noop} onStartTemplate={noop} />);
    expect(screen.getByText("Demo")).toBeTruthy();           // flipped to My projects
  });
});
