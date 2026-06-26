// studio/__tests__/components/number-field.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { NumberField } from "../../src/components/inspector/inspectorControls";

describe("NumberField", () => {
  afterEach(() => cleanup());
  it("lets you clear the field fully (no value forced)", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");           // empty is allowed (not snapped back)
  });
  it("commits px on blur with a numeric value", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("300px");
  });
  it("commits on Enter", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "48" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("48px");
  });
  it("emits nothing when blurred empty", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("ignores non-numeric on commit", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
