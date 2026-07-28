// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_SENTINEL } from "../../server/memoryContract";

const TPL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
  "CLAUDE.md.tpl",
);

describe("CLAUDE.md template — memory capture", () => {
  const tpl = fs.readFileSync(TPL, "utf-8");

  it("uses the same sentinel the server parses", () => {
    // If these drift, the agent proposes and nothing is ever recorded.
    expect(tpl).toContain(MEMORY_SENTINEL);
  });

  it("makes the memory step part of the required response shape", () => {
    const shape = tpl.slice(
      tpl.indexOf("## Response shape"),
      tpl.indexOf("## Design system"),
    );
    expect(shape).toContain(MEMORY_SENTINEL);
  });

  it("still forbids the agent editing memory files itself", () => {
    expect(tpl).toMatch(/read-only to you/);
  });

  it("no longer tells the designer to add rules by hand for remember:", () => {
    // Studio captures now; sending them to the panel was the honest stopgap
    // while nothing wrote memory, and is now wrong.
    expect(tpl).not.toMatch(/tell them to add it under/i);
  });

  it("tells the agent to record only durable preferences, not this-frame tweaks", () => {
    expect(tpl).toMatch(/durable/i);
  });

  it("keeps the deviations contract intact", () => {
    expect(tpl).toMatch(/### Deviations/);
  });
});
