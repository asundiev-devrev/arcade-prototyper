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
    expect(extractComposites(src).sort()).toEqual(["Card", "Footer", "Hero"]);
  });

  it("dedupes repeated identifiers", () => {
    const src = [
      `import { Button } from "@xorkavi/arcade-gen";`,
      `import { Button } from "@xorkavi/arcade-gen";`,
    ].join("\n");
    expect(extractComposites(src)).toEqual(["Button"]);
  });
});
