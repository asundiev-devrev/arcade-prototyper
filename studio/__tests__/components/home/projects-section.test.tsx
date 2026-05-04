import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProjectsSection } from "../../../src/components/home/ProjectsSection";
import type { Project } from "../../../server/types";

afterEach(() => cleanup());

function fixture(overrides: Partial<Project> = {}): Project {
  return {
    slug: "demo",
    name: "Demo",
    theme: "arcade",
    mode: "light",
    createdAt: new Date("2026-01-01").toISOString(),
    updatedAt: new Date("2026-01-01").toISOString(),
    frames: [],
    ...overrides,
  } as Project;
}

describe("ProjectsSection", () => {
  it("renders nothing when there are zero projects", () => {
    const { container } = render(
      <ProjectsSection projects={[]} onOpen={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the heading and one card per project", () => {
    render(
      <ProjectsSection
        projects={[fixture({ slug: "a", name: "Alpha" }), fixture({ slug: "b", name: "Beta" })]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: /projects/i })).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });
});
