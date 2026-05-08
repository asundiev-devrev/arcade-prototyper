import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NewFrameCard } from "../../src/components/viewport/NewFrameCard";

afterEach(() => {
  cleanup();
});

describe("NewFrameCard", () => {
  it("renders a button with a '+ New frame' label", () => {
    render(<NewFrameCard onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /new frame/i })).toBeTruthy();
  });

  it("calls onClick when the button is clicked", () => {
    const onClick = vi.fn();
    render(<NewFrameCard onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /new frame/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables the button while busy", () => {
    render(<NewFrameCard onClick={() => {}} busy />);
    const btn = screen.getByRole("button", { name: /new frame/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
