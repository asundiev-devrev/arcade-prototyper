// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppearanceSection } from "../../src/components/inspector/AppearanceSection";
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

describe("AppearanceSection", () => {
  it("shows opacity as percent and writes the unitless value", () => {
    const change = vi.fn();
    render(<AppearanceSection styles={STYLES} pending={{}} change={change} />);
    const op = screen.getByLabelText("Opacity") as HTMLInputElement;
    expect(op.value).toBe("100");
    fireEvent.change(op, { target: { value: "50" } });
    expect(change).toHaveBeenCalledWith("opacity", "0.5");
  });
  it("corner radius writes px", () => {
    const change = vi.fn();
    render(<AppearanceSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.change(screen.getByLabelText("Corner radius"), { target: { value: "8" } });
    expect(change).toHaveBeenCalledWith("borderRadius", "8px");
  });
});
