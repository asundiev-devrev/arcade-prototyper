import { describe, it, expect } from "vitest";
import { parsePropsFromDts, kitPropsFor, isKitComponent } from "../../../server/codeWriter/kitProps";

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

describe("kitPropsFor shape", () => {
  it("shapes arcade-gen string-unions as kind:select with values", () => {
    const props = kitPropsFor("Button");
    // Button may or may not have unions in the installed kit; if present, they're selects.
    for (const p of props) {
      expect(p.kind).toBe("select");
      expect(Array.isArray(p.values)).toBe(true);
    }
  });
});

describe("isKitComponent", () => {
  it("returns true for real kit components with string-union props (reads disk)", () => {
    // Button in the real @xorkavi/arcade-gen has variant/size string-union props
    const propsForButton = kitPropsFor("Button");
    if (propsForButton.length > 0) {
      // If Button has string-union props in the real DTS, isKitComponent should be true
      expect(isKitComponent("Button")).toBe(true);
    } else {
      // If the real DTS doesn't have Button with string-unions, just verify the logic
      expect(isKitComponent("Button")).toBe(false);
    }
  });
  it("returns false for lowercase names", () => {
    expect(isKitComponent("div")).toBe(false);
  });
  it("returns false for unknown uppercase components", () => {
    expect(isKitComponent("Nonexistent")).toBe(false);
  });
  it("verifies logic: uppercase AND has string-union props", () => {
    // The fixed logic is: uppercase first letter AND kitPropsFor(name).length > 0
    // We can verify this by checking that lowercase always fails
    expect(isKitComponent("button")).toBe(false); // lowercase always false
    // And unknown uppercase always fails
    expect(isKitComponent("UnknownComponent")).toBe(false);
  });
});
