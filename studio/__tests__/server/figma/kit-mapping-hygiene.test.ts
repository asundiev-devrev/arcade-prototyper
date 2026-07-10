// studio/__tests__/server/figma/kit-mapping-hygiene.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SET_KEY_TO_KIT,
  SET_NAME_TO_KIT,
  PSEUDO_KIT_RENDERS,
  NON_RENDERABLE_KIT_EXPORTS,
} from "../../../server/figma/kitMappings";

const emitSrc = readFileSync(
  join(__dirname, "../../../server/figma/kitEmit.ts"),
  "utf-8",
);
const emittedCases = new Set(
  [...emitSrc.matchAll(/case\s+"([A-Za-z]+)":/g)].map((m) => m[1]),
);

describe("kit mapping hygiene", () => {
  it("every component-mapped kit name has an emit case or a pseudo-kit route", () => {
    const names = new Set<string>([
      ...Object.values(SET_KEY_TO_KIT),
      ...Object.values(SET_NAME_TO_KIT),
    ]);
    for (const name of names) {
      const ok = emittedCases.has(name) || name in PSEUDO_KIT_RENDERS;
      expect(ok, `"${name}" is mapped but has no emit case (would fall to default → static div)`).toBe(true);
    }
  });

  it("no component-mapped kit name is a bare compound namespace object", () => {
    for (const name of new Set([...Object.values(SET_KEY_TO_KIT), ...Object.values(SET_NAME_TO_KIT)])) {
      // Compounds may only appear as dotted sub-components; a bare mapping to one
      // means the emit case must use <Name.Sub/>, never <Name/>. Enforce that any
      // such name is NOT emitted bare.
      if (NON_RENDERABLE_KIT_EXPORTS.has(name)) {
        const bare = new RegExp(`<${name}\\s*[/>]`);
        expect(bare.test(emitSrc), `<${name}/> emitted bare — will white-screen`).toBe(false);
      }
    }
  });
});
