import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitLiftForFrame } from "../../server/plugins/liftEmitPlugin";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-lift-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  const frameDir = path.join(tmp, "projects", "p", "frames", "hello");
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(
    path.join(frameDir, "index.tsx"),
    `import { VistaPage } from "arcade-prototypes";\nexport default () => <VistaPage title="x" />;`,
  );
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("emitLiftForFrame", () => {
  it("writes LIFT.md and LIFT.json next to index.tsx", async () => {
    await emitLiftForFrame("p", "hello");
    const frameDir = path.join(tmp, "projects", "p", "frames", "hello");
    expect(fs.existsSync(path.join(frameDir, "LIFT.md"))).toBe(true);
    expect(fs.existsSync(path.join(frameDir, "LIFT.json"))).toBe(true);

    const md = fs.readFileSync(path.join(frameDir, "LIFT.md"), "utf-8");
    expect(md).toContain("# Lift Manifest — p/hello");
    expect(md).toContain("list-view");

    const json = JSON.parse(fs.readFileSync(path.join(frameDir, "LIFT.json"), "utf-8"));
    expect(json.schemaVersion).toBe(1);
    expect(json.shape).toBe("list-view");
  });

  it("is a no-op when the frame file is missing", async () => {
    await expect(emitLiftForFrame("p", "does-not-exist")).resolves.toBeUndefined();
  });
});
