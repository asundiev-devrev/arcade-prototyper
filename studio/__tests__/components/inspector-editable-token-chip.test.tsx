// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EditableTokenChip } from "../../src/components/inspector/EditableTokenChip";

afterEach(cleanup);
const OPTS = [{ value: "text-body", label: "Body" }, { value: "text-title-large", label: "Title large" }];

describe("EditableTokenChip", () => {
  it("token mode: shows the token dropdown and emits onPickToken", () => {
    const onPick = vi.fn();
    render(<EditableTokenChip ariaLabel="Style" tokenValue="text-body" tokenOptions={OPTS}
      rawValue="13px" onPickToken={onPick} onRawChange={vi.fn()} />);
    const sel = screen.getByLabelText("Style") as HTMLSelectElement;
    expect(sel.value).toBe("text-body");
    fireEvent.change(sel, { target: { value: "text-title-large" } });
    expect(onPick).toHaveBeenCalledWith("text-title-large");
  });

  it("switches to raw mode and emits onRawChange", () => {
    const onRaw = vi.fn();
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(0,0,0)" onPickToken={vi.fn()} onRawChange={onRaw} />);
    // an "edit raw" control toggles to a text input
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    const input = screen.getByLabelText("Text raw") as HTMLInputElement;
    expect(input.value).toBe("rgb(0,0,0)");
    fireEvent.change(input, { target: { value: "#ff0000" } });
    expect(onRaw).toHaveBeenCalledWith("#ff0000");
  });

  it("renders a swatch when swatch prop is set", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(1,2,3)" onPickToken={vi.fn()} onRawChange={vi.fn()} swatch="rgb(1,2,3)" />);
    const sw = screen.getByTestId("token-chip-swatch");
    expect(sw.style.background).toBe("rgb(1, 2, 3)");
  });

  it("rawEnabled=false hides the raw toggle (token-only)", () => {
    render(<EditableTokenChip ariaLabel="Style" tokenValue="text-body" tokenOptions={OPTS}
      rawValue="" onPickToken={vi.fn()} onRawChange={vi.fn()} rawEnabled={false} />);
    expect(screen.queryByLabelText("Edit Style raw value")).toBeNull();
  });

  it("onBlur exits raw mode", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(0,0,0)" onPickToken={vi.fn()} onRawChange={vi.fn()} />);
    // Enter raw mode
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    const input = screen.getByLabelText("Text raw") as HTMLInputElement;
    expect(input).toBeDefined();
    // Fire blur on the input to exit raw mode
    fireEvent.blur(input);
    // Assert raw mode exited: input is gone, # button is back
    expect(screen.queryByLabelText("Text raw")).toBeNull();
    expect(screen.getByLabelText("Edit Text raw value")).toBeDefined();
  });

  it("back-to-tokens button exits raw mode", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(0,0,0)" onPickToken={vi.fn()} onRawChange={vi.fn()} />);
    // Enter raw mode
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    expect(screen.getByLabelText("Text raw")).toBeDefined();
    // Click the back-to-tokens button
    fireEvent.click(screen.getByLabelText("Text use tokens"));
    // Assert raw mode exited: input is gone, # button is back
    expect(screen.queryByLabelText("Text raw")).toBeNull();
    expect(screen.getByLabelText("Edit Text raw value")).toBeDefined();
  });

  it("raw-mode swatch renders with testid", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(1,2,3)" onPickToken={vi.fn()} onRawChange={vi.fn()} swatch="rgb(1,2,3)" />);
    // Enter raw mode
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    // Assert swatch is present in raw mode
    const sw = screen.getByTestId("token-chip-swatch");
    expect(sw).toBeDefined();
    expect(sw.style.background).toBe("rgb(1, 2, 3)");
  });
});
