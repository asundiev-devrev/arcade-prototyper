// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  snapshotProjectFiles,
  diffSnapshots,
  hasAnyChange,
  NO_CHANGES_TRAILER,
} from "../../server/frameChangeContract";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framechange-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writeFrame(rel: string, body: string): Promise<void> {
  const full = path.join(tmpRoot, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
}

describe("snapshotProjectFiles", () => {
  it("returns an empty map when neither frames/ nor shared/ exists", async () => {
    const snap = await snapshotProjectFiles(tmpRoot);
    expect(snap.size).toBe(0);
  });

  it("captures all .tsx files under frames/", async () => {
    await writeFrame("frames/01-home/index.tsx", "export default () => null;");
    await writeFrame("frames/02-about/index.tsx", "export default () => null;");
    const snap = await snapshotProjectFiles(tmpRoot);
    expect([...snap.keys()].sort()).toEqual([
      "frames/01-home/index.tsx",
      "frames/02-about/index.tsx",
    ]);
  });

  it("captures shared/ helpers as well", async () => {
    await writeFrame("shared/devrev.ts", "export const x = 1;");
    await writeFrame("shared/styles.css", ".a {}");
    const snap = await snapshotProjectFiles(tmpRoot);
    expect([...snap.keys()].sort()).toEqual([
      "shared/devrev.ts",
      "shared/styles.css",
    ]);
  });

  it("ignores files outside frames/ and shared/", async () => {
    await writeFrame("frames/01/index.tsx", "x");
    await writeFrame("project.json", "{}");
    await writeFrame("chat-history.json", "[]");
    const snap = await snapshotProjectFiles(tmpRoot);
    expect([...snap.keys()]).toEqual(["frames/01/index.tsx"]);
  });

  it("ignores irrelevant file extensions", async () => {
    await writeFrame("frames/01/index.tsx", "x");
    await writeFrame("frames/01/screenshot.png", "binary");
    await writeFrame("frames/01/notes.txt", "scratch");
    const snap = await snapshotProjectFiles(tmpRoot);
    expect([...snap.keys()]).toEqual(["frames/01/index.tsx"]);
  });
});

describe("diffSnapshots + hasAnyChange", () => {
  it("reports no changes when before === after", async () => {
    await writeFrame("frames/01/index.tsx", "x");
    const before = await snapshotProjectFiles(tmpRoot);
    const after = await snapshotProjectFiles(tmpRoot);
    const diff = diffSnapshots(before, after);
    expect(diff).toEqual({ added: [], changed: [], removed: [] });
    expect(hasAnyChange(diff)).toBe(false);
  });

  it("flags a file whose content changed", async () => {
    await writeFrame("frames/01/index.tsx", "short");
    const before = await snapshotProjectFiles(tmpRoot);
    await writeFrame("frames/01/index.tsx", "considerably longer body");
    const after = await snapshotProjectFiles(tmpRoot);
    const diff = diffSnapshots(before, after);
    expect(diff.changed).toEqual(["frames/01/index.tsx"]);
    expect(hasAnyChange(diff)).toBe(true);
  });

  it("flags a same-length content change (hash, not size)", () => {
    // Two files of equal length but different bytes must register as a
    // change — a size-only check would miss this.
    const before = new Map([["frames/a.tsx", { hash: "aaa", size: 50 }]]);
    const after = new Map([["frames/a.tsx", { hash: "bbb", size: 50 }]]);
    const diff = diffSnapshots(before, after);
    expect(diff.changed).toEqual(["frames/a.tsx"]);
    expect(hasAnyChange(diff)).toBe(true);
  });

  it("treats a no-op rewrite (identical content) as NO change", async () => {
    // Regression for the silent-ignore failure: the agent rewrites a file
    // with byte-identical content, bumping mtime but changing nothing. A
    // content hash must report this as unchanged so the no-frame-changes
    // warning still fires. An mtime-based check would wrongly see a change
    // and suppress the warning.
    await writeFrame("frames/01/index.tsx", "export default () => null;");
    const before = await snapshotProjectFiles(tmpRoot);
    // Rewrite with the exact same bytes, a tick later.
    await new Promise((r) => setTimeout(r, 15));
    await writeFrame("frames/01/index.tsx", "export default () => null;");
    const after = await snapshotProjectFiles(tmpRoot);
    const diff = diffSnapshots(before, after);
    expect(diff.changed).toEqual([]);
    expect(hasAnyChange(diff)).toBe(false);
  });

  it("flags newly added files", async () => {
    const before = await snapshotProjectFiles(tmpRoot);
    await writeFrame("frames/02/index.tsx", "new");
    const after = await snapshotProjectFiles(tmpRoot);
    const diff = diffSnapshots(before, after);
    expect(diff.added).toEqual(["frames/02/index.tsx"]);
    expect(hasAnyChange(diff)).toBe(true);
  });

  it("flags removed files", async () => {
    await writeFrame("frames/01/index.tsx", "x");
    const before = await snapshotProjectFiles(tmpRoot);
    await fs.rm(path.join(tmpRoot, "frames/01/index.tsx"));
    const after = await snapshotProjectFiles(tmpRoot);
    const diff = diffSnapshots(before, after);
    expect(diff.removed).toEqual(["frames/01/index.tsx"]);
    expect(hasAnyChange(diff)).toBe(true);
  });
});

describe("NO_CHANGES_TRAILER", () => {
  it("starts with a blank-line separator so it joins cleanly to preceding narration", () => {
    expect(NO_CHANGES_TRAILER.startsWith("\n\n")).toBe(true);
  });

  it("contains a warning marker so the UI can visually distinguish it", () => {
    expect(NO_CHANGES_TRAILER).toMatch(/⚠/);
  });

  it("uses designer-facing language, not engineering jargon", () => {
    // Negative assertion — if anyone re-introduces these words the test
    // surfaces the regression. Designer-facing register is part of the
    // contract, not a stylistic preference.
    expect(NO_CHANGES_TRAILER).not.toMatch(/mtime/i);
    expect(NO_CHANGES_TRAILER).not.toMatch(/snapshot/i);
    expect(NO_CHANGES_TRAILER).not.toMatch(/tool[_ ]?call/i);
    expect(NO_CHANGES_TRAILER).not.toMatch(/filesystem/i);
  });
});
