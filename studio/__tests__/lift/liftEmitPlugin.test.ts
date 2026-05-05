import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitLiftForFrame, emitForExistingFrames } from "../../server/plugins/liftEmitPlugin";

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
  it("writes LIFT.xml and LIFT.json next to index.tsx", async () => {
    await emitLiftForFrame("p", "hello");
    const frameDir = path.join(tmp, "projects", "p", "frames", "hello");
    expect(fs.existsSync(path.join(frameDir, "LIFT.xml"))).toBe(true);
    expect(fs.existsSync(path.join(frameDir, "LIFT.json"))).toBe(true);

    const xml = fs.readFileSync(path.join(frameDir, "LIFT.xml"), "utf-8");
    expect(xml).toContain(`<lift_manifest schema_version="1"`);
    expect(xml).toContain(`project="p"`);
    expect(xml).toContain(`frame="hello"`);
    expect(xml).toContain(`shape="list-view"`);

    const json = JSON.parse(fs.readFileSync(path.join(frameDir, "LIFT.json"), "utf-8"));
    expect(json.schemaVersion).toBe(1);
    expect(json.shape).toBe("list-view");
  });

  it("removes a stale LIFT.md left by an older Studio install", async () => {
    const frameDir = path.join(tmp, "projects", "p", "frames", "hello");
    fs.writeFileSync(path.join(frameDir, "LIFT.md"), "# old junk from 0.8.x");

    await emitLiftForFrame("p", "hello");

    expect(fs.existsSync(path.join(frameDir, "LIFT.md"))).toBe(false);
    expect(fs.existsSync(path.join(frameDir, "LIFT.xml"))).toBe(true);
  });

  it("is a no-op when the frame file is missing", async () => {
    await expect(emitLiftForFrame("p", "does-not-exist")).resolves.toBeUndefined();
  });
});

describe("emitForExistingFrames", () => {
  it("emits a manifest for every pre-existing frame on startup", async () => {
    // Two projects, two frames each — the shape an app-restart sees.
    const mkFrame = (project: string, frame: string, src: string) => {
      const dir = path.join(tmp, "projects", project, "frames", frame);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "index.tsx"), src);
    };
    mkFrame("p", "world", `import { Button } from "arcade";\nexport default () => null;`);
    mkFrame("q", "hi", `import { SettingsPage } from "arcade-prototypes";\nexport default () => null;`);
    mkFrame("q", "bye", `import { Modal } from "arcade";\nexport default () => null;`);

    await emitForExistingFrames();

    // Every existing frame now has both artifacts next to it.
    for (const [project, frame] of [
      ["p", "hello"], // the one created in beforeEach
      ["p", "world"],
      ["q", "hi"],
      ["q", "bye"],
    ] as const) {
      const dir = path.join(tmp, "projects", project, "frames", frame);
      expect(fs.existsSync(path.join(dir, "LIFT.xml"))).toBe(true);
      expect(fs.existsSync(path.join(dir, "LIFT.json"))).toBe(true);
    }
  });

  it("ignores dotfile project slugs like .DS_Store and .figma-ingest", async () => {
    fs.mkdirSync(path.join(tmp, "projects", ".DS_Store"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects", ".DS_Store", "junk"), "");
    await expect(emitForExistingFrames()).resolves.toBeUndefined();
  });
});
