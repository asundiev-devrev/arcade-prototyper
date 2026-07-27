// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_WATCH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "server",
  "plugins",
  "projectWatchPlugin.ts",
);

const LIFT_EMIT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "server",
  "plugins",
  "liftEmitPlugin.ts",
);

describe("chokidar watcher symlink policy", () => {
  it("projectWatchPlugin passes followSymlinks:false", () => {
    const src = fs.readFileSync(PROJECT_WATCH, "utf-8");
    expect(src).toContain("followSymlinks: false");
  });

  it("liftEmitPlugin passes followSymlinks:false", () => {
    const src = fs.readFileSync(LIFT_EMIT, "utf-8");
    expect(src).toContain("followSymlinks: false");
  });
});
