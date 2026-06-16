import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompositeSection, buildComponentSection } from "../../server/assetsCatalog";
import { getExampleNames, EXAMPLE_OPT_OUT } from "../../prototype-kit/examples/registry";

const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "prototype-kit",
);

describe("example coverage", () => {
  it("every composite + component has an example or an explicit opt-out", async () => {
    const composites = (await buildCompositeSection(KIT_ROOT)).items as { name: string }[];
    const components = buildComponentSection().items as { name: string }[];
    const need = [...composites, ...components].map((i) => i.name);
    const covered = new Set([...getExampleNames(), ...EXAMPLE_OPT_OUT]);
    const missing = need.filter((n) => !covered.has(n));
    expect(missing, `missing examples for: ${missing.join(", ")}`).toEqual([]);
  });
});
