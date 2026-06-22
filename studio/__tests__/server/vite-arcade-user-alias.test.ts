import { describe, it, expect } from "vitest";
import path from "node:path";

describe("arcade-user alias", () => {
  it("is declared in vite.config and points at user-kit/composites", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.resolve(__dirname, "../../vite.config.ts"), "utf-8"),
    );
    expect(src).toMatch(/arcade-user/);
    expect(src).toMatch(/user-kit/);
  });
});
