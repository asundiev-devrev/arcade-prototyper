import { describe, it, expect } from "vitest";
import { extractComposites } from "../../src/lib/agentCursor";

describe("extractComposites", () => {
  it("returns [] for empty input", () => {
    expect(extractComposites("")).toEqual([]);
  });

  it("returns [] when no composite imports are present", () => {
    expect(extractComposites('import { useState } from "react";')).toEqual([]);
  });

  it("extracts named imports from @xorkavi/arcade-gen", () => {
    const src = `import { Button, Input as Field } from "@xorkavi/arcade-gen";`;
    expect(extractComposites(src)).toEqual(["Button", "Input"]);
  });

  it("extracts default and named imports from a relative composites path", () => {
    const src = [
      `import Hero from "../prototype-kit/composites/Hero";`,
      `import { Card, Footer } from "../../prototype-kit/composites/CardKit";`,
    ].join("\n");
    expect(extractComposites(src)).toEqual(["Hero", "Card", "Footer"]);
  });

  it("dedupes repeated identifiers (insertion-ordered)", () => {
    const src = [
      `import { Button } from "@xorkavi/arcade-gen";`,
      `import { Button } from "@xorkavi/arcade-gen";`,
    ].join("\n");
    expect(extractComposites(src)).toEqual(["Button"]);
  });

  it("extracts mixed default + named imports from @xorkavi/arcade-gen", () => {
    const src = `import Hero, { Button, Input as Field } from "@xorkavi/arcade-gen";`;
    expect(extractComposites(src)).toEqual(["Hero", "Button", "Input"]);
  });

  it("extracts plain default import from @xorkavi/arcade-gen", () => {
    const src = `import Hero from "@xorkavi/arcade-gen";`;
    expect(extractComposites(src)).toEqual(["Hero"]);
  });

  it("extracts mixed default + named imports from composites path", () => {
    const src = `import Hero, { Footer } from "../prototype-kit/composites/HeroKit";`;
    expect(extractComposites(src)).toEqual(["Hero", "Footer"]);
  });
});
