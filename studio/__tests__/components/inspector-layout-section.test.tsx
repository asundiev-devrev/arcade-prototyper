// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LayoutSection } from "../../src/components/inspector/LayoutSection";
import type { StyleSnapshot } from "../../src/hooks/editSessionContext";

const STYLES: StyleSnapshot = {
  text: "", fontSize: "16px", fontWeight: "400", fontStyle: "normal", textAlign: "left",
  color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)", borderColor: "rgb(0,0,0)",
  paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
  marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
  gap: "0px", width: "200px", height: "100px",
  minWidth: "0px", maxWidth: "none", minHeight: "0px", maxHeight: "none",
  display: "block", flexDirection: "row", opacity: "1", borderRadius: "0px",
  appliedTokens: {},
};
afterEach(cleanup);

describe("LayoutSection", () => {
  it("layout-mode Row writes display:flex + flexDirection:row", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.click(screen.getByTitle("Row"));
    expect(change).toHaveBeenCalledWith("display", "flex");
    expect(change).toHaveBeenCalledWith("flexDirection", "row");
  });
  it("Grid writes display:grid", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.click(screen.getByTitle("Grid"));
    expect(change).toHaveBeenCalledWith("display", "grid");
  });
  it("editing W writes width in px", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.change(screen.getByLabelText("W"), { target: { value: "300" } });
    expect(change).toHaveBeenCalledWith("width", "300px");
  });
  it("aspect-lock: editing W also writes H at the same ratio", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    // ratio H/W = 100/200 = 0.5
    fireEvent.click(screen.getByLabelText(/lock aspect/i));
    fireEvent.change(screen.getByLabelText("W"), { target: { value: "400" } });
    expect(change).toHaveBeenCalledWith("width", "400px");
    expect(change).toHaveBeenCalledWith("height", "200px");
  });
  it("gap hidden unless flex/grid", () => {
    const change = vi.fn();
    const { rerender } = render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    expect(screen.queryByLabelText("Gap")).toBeNull();
    rerender(<LayoutSection styles={STYLES} pending={{ display: "flex" }} change={change} />);
    expect(screen.getByLabelText("Gap")).toBeTruthy();
  });
  it("expand padding reveals four side fields", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.click(screen.getByLabelText(/expand padding/i));
    expect(screen.getByLabelText("Padding top")).toBeTruthy();
    expect(screen.getByLabelText("Padding left")).toBeTruthy();
  });
  it("mixed padding shows empty uniform field with placeholder + auto-expands sides", () => {
    const change = vi.fn();
    const mixedStyles = { ...STYLES, paddingTop: "12px", paddingLeft: "24px" };
    render(<LayoutSection styles={mixedStyles} pending={{}} change={change} />);
    const uniformField = screen.getByLabelText("Padding") as HTMLInputElement;
    expect(uniformField.value).toBe("");
    expect(uniformField.placeholder).toBe("Mixed");
    expect(screen.getByLabelText("Padding left")).toBeTruthy();
    expect(screen.getByLabelText("Padding top")).toBeTruthy();
  });
});
