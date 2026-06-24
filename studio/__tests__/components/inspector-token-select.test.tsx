// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TokenSelect } from "../../src/components/inspector/TokenSelect";

afterEach(cleanup);

const OPTS = [
  { value: "text-body", label: "Body" },
  { value: "text-title-large", label: "Title large" },
];

describe("TokenSelect", () => {
  it("shows the selected option label", () => {
    render(<TokenSelect options={OPTS} value="text-title-large" onPick={vi.fn()} ariaLabel="Style" />);
    const sel = screen.getByLabelText("Style") as HTMLSelectElement;
    expect(sel.value).toBe("text-title-large");
  });
  it("shows placeholder when value is null", () => {
    render(<TokenSelect options={OPTS} value={null} onPick={vi.fn()} ariaLabel="Style" placeholder="— (no token)" />);
    const sel = screen.getByLabelText("Style") as HTMLSelectElement;
    expect(sel.value).toBe(""); // placeholder option selected
    expect(screen.getByText("— (no token)")).toBeTruthy();
  });
  it("emits the chosen value", () => {
    const onPick = vi.fn();
    render(<TokenSelect options={OPTS} value="text-body" onPick={onPick} ariaLabel="Style" />);
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "text-title-large" } });
    expect(onPick).toHaveBeenCalledWith("text-title-large");
  });
});
