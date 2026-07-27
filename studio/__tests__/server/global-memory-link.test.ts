// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureGlobalMemoryLink } from "../../server/memory";

describe("ensureGlobalMemoryLink", () => {
  let tmpRoot: string;
  let linkPath: string;
  let targetDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio-global-memory-link-"));
    process.env.ARCADE_STUDIO_ROOT = tmpRoot;
    linkPath = path.join(tmpRoot, "project", "global-memory");
    targetDir = path.join(tmpRoot, "memory");
  });

  afterEach(async () => {
    delete process.env.ARCADE_STUDIO_ROOT;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  test("creates the symlink pointing at the global memory dir", async () => {
    await ensureGlobalMemoryLink(linkPath, targetDir);

    const stat = await fs.lstat(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);

    const target = await fs.readlink(linkPath);
    expect(target).toBe(targetDir);
  });

  test("idempotent: calling twice leaves one correct link, no throw", async () => {
    await ensureGlobalMemoryLink(linkPath, targetDir);
    await ensureGlobalMemoryLink(linkPath, targetDir);

    const stat = await fs.lstat(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);

    const target = await fs.readlink(linkPath);
    expect(target).toBe(targetDir);
  });

  test("repairs a symlink pointing at the WRONG target", async () => {
    const wrongTarget = path.join(tmpRoot, "wrong-target");
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.mkdir(wrongTarget, { recursive: true });
    await fs.symlink(wrongTarget, linkPath, "dir");

    await ensureGlobalMemoryLink(linkPath, targetDir);

    const stat = await fs.lstat(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);

    const target = await fs.readlink(linkPath);
    expect(target).toBe(targetDir);
  });

  test("does NOT delete a real directory occupying that path (data-safety)", async () => {
    await fs.mkdir(linkPath, { recursive: true });
    await fs.writeFile(path.join(linkPath, "user-data.txt"), "important");

    await ensureGlobalMemoryLink(linkPath, targetDir);

    const stat = await fs.lstat(linkPath);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);

    const file = await fs.readFile(path.join(linkPath, "user-data.txt"), "utf-8");
    expect(file).toBe("important");
  });

  test("never throws when the target parent is unwritable or the path is bogus", async () => {
    const unwritableLinkPath = "/root/unwritable/global-memory";
    await expect(ensureGlobalMemoryLink(unwritableLinkPath, targetDir)).resolves.toBeUndefined();
  });
});
