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

  it("blurring out of the whole chip exits raw mode", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(0,0,0)" onPickToken={vi.fn()} onRawChange={vi.fn()} />);
    // Enter raw mode
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    const input = screen.getByLabelText("Text raw") as HTMLInputElement;
    expect(input).toBeDefined();
    // Blur with focus leaving the chip entirely (relatedTarget outside) → exit
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    fireEvent.blur(input, { relatedTarget: outside });
    expect(screen.queryByLabelText("Text raw")).toBeNull();
    expect(screen.getByLabelText("Edit Text raw value")).toBeDefined();
  });

  it("REGRESSION: clicking the colour picker (focus moves to a sibling control) does NOT exit raw mode", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(0,0,0)" onPickToken={vi.fn()} onRawChange={vi.fn()} swatch="rgb(0,0,0)" />);
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    const textInput = screen.getByLabelText("Text raw") as HTMLInputElement;
    const picker = screen.getByTestId("token-chip-swatch") as HTMLInputElement;
    // Focus moves text input -> colour picker (a sibling inside the chip)
    fireEvent.blur(textInput, { relatedTarget: picker });
    // Still in raw mode: both the picker and the text field remain
    expect(screen.getByTestId("token-chip-swatch")).toBeDefined();
    expect(screen.getByLabelText("Text raw")).toBeDefined();
  });

  it("opening the OS colour dialog (relatedTarget null) does NOT exit raw mode", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(0,0,0)" onPickToken={vi.fn()} onRawChange={vi.fn()} swatch="rgb(0,0,0)" />);
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    const picker = screen.getByTestId("token-chip-swatch") as HTMLInputElement;
    // Native picker opening blurs to the OS dialog → relatedTarget is null
    fireEvent.blur(picker, { relatedTarget: null });
    expect(screen.getByTestId("token-chip-swatch")).toBeDefined();
    expect(screen.getByLabelText("Text raw")).toBeDefined();
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

  it("raw-mode swatch is a native color picker seeded with the current colour as hex", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(1, 2, 3)" onPickToken={vi.fn()} onRawChange={vi.fn()} swatch="rgb(1, 2, 3)" />);
    // Enter raw mode
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    const picker = screen.getByTestId("token-chip-swatch") as HTMLInputElement;
    expect(picker.tagName).toBe("INPUT");
    expect(picker.type).toBe("color");
    expect(picker.value).toBe("#010203"); // rgb(1,2,3) -> hex
  });

  it("raw-mode color picker emits the chosen hex via onRawChange", () => {
    const onRaw = vi.fn();
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(0, 0, 0)" onPickToken={vi.fn()} onRawChange={onRaw} swatch="rgb(0, 0, 0)" />);
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    const picker = screen.getByTestId("token-chip-swatch") as HTMLInputElement;
    fireEvent.input(picker, { target: { value: "#ff8800" } });
    expect(onRaw).toHaveBeenCalledWith("#ff8800");
  });

  it("raw-mode color picker falls back to #000000 for an unparseable value", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="transparent" onPickToken={vi.fn()} onRawChange={vi.fn()} swatch="transparent" />);
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    const picker = screen.getByTestId("token-chip-swatch") as HTMLInputElement;
    expect(picker.value).toBe("#000000");
  });
});
