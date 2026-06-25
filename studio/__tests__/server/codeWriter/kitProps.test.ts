import { describe, it, expect } from "vitest";
import { parsePropsFromDts } from "../../../server/codeWriter/kitProps";

// parsePropsFromDts is the pure core (no disk) so it's unit-testable.
const DTS = `
export interface ButtonProps {
  variant?: "primary" | "secondary" | "tertiary";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  onClick?: () => void;
}
export declare const Button: React.FC<ButtonProps>;
`;

describe("parsePropsFromDts", () => {
  it("extracts string-union props for a component", () => {
    const props = parsePropsFromDts(DTS, "Button");
    expect(props).toContainEqual({ name: "variant", values: ["primary", "secondary", "tertiary"] });
    expect(props).toContainEqual({ name: "size", values: ["sm", "md", "lg"] });
  });
  it("omits non-union props (boolean, functions)", () => {
    const props = parsePropsFromDts(DTS, "Button");
    expect(props.find((p) => p.name === "disabled")).toBeUndefined();
    expect(props.find((p) => p.name === "onClick")).toBeUndefined();
  });
  it("returns [] for an unknown component", () => {
    expect(parsePropsFromDts(DTS, "Nonexistent")).toEqual([]);
  });
});
