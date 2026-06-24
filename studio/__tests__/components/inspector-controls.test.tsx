// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NumberField, SegmentedToggle, toNumberInput, fromNumberInput } from "../../src/components/inspector/inspectorControls";

afterEach(cleanup);

describe("px helpers", () => {
  it("strip and re-add px", () => {
    expect(toNumberInput("16px")).toBe("16");
    expect(fromNumberInput("16")).toBe("16px");
    expect(fromNumberInput("")).toBe("");
  });
});

describe("NumberField", () => {
  it("shows the px value without unit and emits px on change", () => {
    const onChange = vi.fn();
    render(<NumberField id="w" label="W" valuePx="120px" onChange={onChange} />);
    const input = screen.getByLabelText("W") as HTMLInputElement;
    expect(input.value).toBe("120");
    fireEvent.change(input, { target: { value: "200" } });
    expect(onChange).toHaveBeenCalledWith("200px");
  });
});

describe("SegmentedToggle", () => {
  it("renders options and emits the chosen value", () => {
    const onChange = vi.fn();
    render(<SegmentedToggle ariaLabel="Layout mode" value="block"
      options={[{ value: "block", label: "Free" }, { value: "flex", label: "Row" }]}
      onChange={onChange} />);
    fireEvent.click(screen.getByText("Row"));
    expect(onChange).toHaveBeenCalledWith("flex");
  });
});
