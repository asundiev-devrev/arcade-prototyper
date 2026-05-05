import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderJson } from "../../src/lift/render";

const FIXTURES = path.join(__dirname, "fixtures");

describe("renderJson", () => {
  it("is valid JSON and round-trips", () => {
    const source = fs.readFileSync(path.join(FIXTURES, "list-frame.tsx"), "utf-8");
    const manifest = buildManifest({
      projectSlug: "demo",
      frameSlug: "list",
      frameAbsPath: "/abs/list.tsx",
      frameSource: source,
      intentSummary: "list",
    });
    const raw = renderJson(manifest);
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.shape).toBe("list-view");
    expect(parsed.frameSlug).toBe("list");
  });
});
