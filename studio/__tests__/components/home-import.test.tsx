import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HomeShelf } from "../../src/components/home/HomeShelf";

// HomeShelf no longer imports from arcade-gen (uses plain buttons for tabs).
// This mock returns an empty object since projects=[] means ProjectsSection
// renders nothing and needs no mocks.
vi.mock("@xorkavi/arcade-gen", () => ({}));

afterEach(() => vi.restoreAllMocks());

describe("HomeShelf import button", () => {
  it("renders an Import button and fires onImport when clicked", () => {
    const onImport = vi.fn();
    render(
      <HomeShelf projects={[]} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} onStartTemplate={() => {}} onImport={onImport} />,
    );
    fireEvent.click(screen.getByText(/import project/i));
    expect(onImport).toHaveBeenCalled();
  });
});
