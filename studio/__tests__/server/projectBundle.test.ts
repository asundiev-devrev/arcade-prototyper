// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cleanProjectJson } from "../../server/projectBundle";
import type { Project } from "../../server/types";

const base: Project = {
  name: "My Project", slug: "my-project",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  theme: "arcade", mode: "light",
  frames: [{ slug: "01-home", name: "Home", size: "1440", createdAt: "2026-01-01T00:00:00.000Z" }],
  chimeIns: [],
};

describe("cleanProjectJson", () => {
  it("strips per-machine fields and resets chimeIns", () => {
    const dirty: Project = {
      ...base,
      sessionId: "sess-123",
      computerConversationId: "conv-xyz",
      deployments: [{ frameSlug: "01-home", url: "https://x", createdAt: "2026-01-01T00:00:00.000Z" }],
      chimeIns: [{ id: "c1", frameSlug: "01-home", status: "pending", message: "hi", createdAt: "2026-01-01T00:00:00.000Z" } as any],
    };
    const clean = cleanProjectJson(dirty);
    expect(clean.sessionId).toBeUndefined();
    expect(clean.computerConversationId).toBeUndefined();
    expect(clean.deployments).toBeUndefined();
    expect(clean.chimeIns).toEqual([]);
    expect(clean.name).toBe("My Project");
    expect(clean.theme).toBe("arcade");
    expect(clean.mode).toBe("light");
    expect(clean.frames).toHaveLength(1);
  });
  it("does not mutate the input", () => {
    const input: Project = { ...base, sessionId: "keep" };
    cleanProjectJson(input);
    expect(input.sessionId).toBe("keep");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach } from "vitest";
import { resolveComponentDeps } from "../../server/projectBundle";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-bundle-"));
  process.env.ARCADE_STUDIO_ROOT = root;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

function writeComposite(name: string, body: string) {
  const dir = path.join(root, "user-kit", "composites");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.tsx`), body);
}
function writeFrame(framesDir: string, frameSlug: string, body: string) {
  const dir = path.join(framesDir, frameSlug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.tsx"), body);
}

describe("resolveComponentDeps", () => {
  it("follows frame -> composite -> composite transitively", async () => {
    writeComposite("PriceTag", `export function PriceTag() { return null; }\nexport default PriceTag;`);
    writeComposite("AppCard", `import { PriceTag } from "arcade-user/PriceTag";\nexport function AppCard() { return null; }\nexport default AppCard;`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { AppCard } from "arcade-user/AppCard";\nexport default function F() { return null; }`);

    const { names, missing } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["AppCard", "PriceTag"]);
    expect(missing).toEqual([]);
  });

  it("terminates on a composite import cycle and collects both", async () => {
    writeComposite("Aa", `import { Bb } from "arcade-user/Bb";\nexport default function Aa(){return null;}`);
    writeComposite("Bb", `import { Aa } from "arcade-user/Aa";\nexport default function Bb(){return null;}`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { Aa } from "arcade-user/Aa";`);
    const { names } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["Aa", "Bb"]);
  });

  it("reports referenced-but-absent components as missing, not found", async () => {
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { Ghost } from "arcade-user/Ghost";`);
    const { names, missing } = await resolveComponentDeps(framesDir);
    expect(names).toEqual([]);
    expect(missing).toEqual(["Ghost"]);
  });

  it("does not match substrings (arcade-user/Foo vs FooBar)", async () => {
    writeComposite("FooBar", `export default function FooBar() { return null; }`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { FooBar } from "arcade-user/FooBar";`);
    const { names } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["FooBar"]); // not "Foo"
  });
});
