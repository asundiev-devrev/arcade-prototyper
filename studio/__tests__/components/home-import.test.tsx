import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HomeShelf } from "../../src/components/home/HomeShelf";

vi.mock("@xorkavi/arcade-gen", () => ({
  ToggleGroup: {
    Root: ({ children }: any) => <div>{children}</div>,
    Item: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  },
}));

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
