// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-inv-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("writeInventory", () => {
  it("writes INVENTORY.md listing an existing frame", async () => {
    const { writeInventory } = await import("../../server/inventory");
    const frames = path.join(tmp, "projects", "demo", "frames", "01-list");
    fs.mkdirSync(frames, { recursive: true });
    fs.writeFileSync(
      path.join(frames, "index.tsx"),
      `import { VistaPage } from "arcade";\nexport default () => <VistaPage title="Tickets" />;`,
    );

    await writeInventory("demo");

    const out = fs.readFileSync(
      path.join(tmp, "projects", "demo", "memory", "INVENTORY.md"),
      "utf-8",
    );
    expect(out).toContain("01-list");
    expect(out).toContain("VistaPage");
  });

  it("writes an empty-state inventory for a project with no frames", async () => {
    const { writeInventory } = await import("../../server/inventory");
    fs.mkdirSync(path.join(tmp, "projects", "fresh"), { recursive: true });

    await writeInventory("fresh");

    const out = fs.readFileSync(
      path.join(tmp, "projects", "fresh", "memory", "INVENTORY.md"),
      "utf-8",
    );
    expect(out).toMatch(/no frames yet/i);
  });

  it("never throws on an invalid slug (fire-and-forget contract)", async () => {
    const { writeInventory } = await import("../../server/inventory");
    // projectDir() throws on a bad slug; writeInventory must swallow it.
    await expect(writeInventory("../escape")).resolves.toBeUndefined();
  });
});
