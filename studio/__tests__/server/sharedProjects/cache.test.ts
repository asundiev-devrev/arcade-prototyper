import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const ORIGINAL = process.env.ARCADE_STUDIO_ROOT;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "studio-cache-"));
  process.env.ARCADE_STUDIO_ROOT = tmpDir;
});

afterEach(async () => {
  if (ORIGINAL) process.env.ARCADE_STUDIO_ROOT = ORIGINAL;
  else delete process.env.ARCADE_STUDIO_ROOT;
  await rm(tmpDir, { recursive: true, force: true });
});

describe("shared-projects cache", () => {
  it("createMirror writes metadata.json", async () => {
    const { createMirror, readMirror } = await import(
      "../../../server/sharedProjects/cache"
    );
    await createMirror({
      id: "abc",
      relayUrl: "https://x.trycloudflare.com",
      hostDevu: "don:.../devu/1",
      hostDisplayName: "Andrey",
      projectSlug: "p",
    });
    const m = await readMirror("abc");
    expect(m?.relayUrl).toBe("https://x.trycloudflare.com");
    expect(m?.hostDisplayName).toBe("Andrey");
  });

  it("appendChat persists messages", async () => {
    const { createMirror, appendChat, readChat } = await import(
      "../../../server/sharedProjects/cache"
    );
    await createMirror({
      id: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    await appendChat("abc", { kind: "prompt_started", text: "hi" });
    await appendChat("abc", { kind: "agent_event" });
    const chat = await readChat("abc");
    expect(chat).toHaveLength(2);
  });

  it("writeFrame stores frame content; readFrames returns the map", async () => {
    const { createMirror, writeFrame, readFrames } = await import(
      "../../../server/sharedProjects/cache"
    );
    await createMirror({
      id: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    await writeFrame("abc", "frame-01", "<jsx>");
    await writeFrame("abc", "frame-02", "<other>");
    const frames = await readFrames("abc");
    expect(frames["frame-01"]).toBe("<jsx>");
    expect(frames["frame-02"]).toBe("<other>");
  });

  it("resolveFrameFsPath finds the modern .tsx filename", async () => {
    const { createMirror, writeFrame, resolveFrameFsPath } = await import(
      "../../../server/sharedProjects/cache"
    );
    await createMirror({
      id: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    await writeFrame("abc", "frame-01", "<jsx>");
    const found = await resolveFrameFsPath("abc", "frame-01");
    expect(found).toMatch(/frame-01\.tsx$/);
  });

  it("resolveFrameFsPath falls back to legacy extension-less mirror files", async () => {
    // Pre-0.23 mirrors stored the file without the `.tsx` extension. The
    // spectator frame compile endpoint must still find them so older
    // mirrors keep rendering until the next cache_replay refreshes them.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { createMirror, resolveFrameFsPath } = await import(
      "../../../server/sharedProjects/cache"
    );
    const { sharedProjectDir } = await import("../../../server/paths");
    await createMirror({
      id: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    const dir = path.join(sharedProjectDir("abc"), "frames");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "frame-old"), "<legacy>");
    const found = await resolveFrameFsPath("abc", "frame-old");
    expect(found).toMatch(/frame-old$/);
  });

  it("readFrames keys map by logical slug regardless of file extension", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { createMirror, writeFrame, readFrames } = await import(
      "../../../server/sharedProjects/cache"
    );
    const { sharedProjectDir } = await import("../../../server/paths");
    await createMirror({
      id: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    await writeFrame("abc", "frame-modern", "<jsx>");
    // Drop a legacy-style file straight on disk to mirror older mirrors.
    const dir = path.join(sharedProjectDir("abc"), "frames");
    await fs.writeFile(path.join(dir, "frame-old"), "<legacy>");
    const frames = await readFrames("abc");
    expect(frames["frame-modern"]).toBe("<jsx>");
    expect(frames["frame-old"]).toBe("<legacy>");
  });

  it("listMirrors skips a single corrupt mirror instead of hiding the rest", async () => {
    // Regression for 0.23.2: a zero-byte metadata.json (e.g. a crash mid
    // mkdir+write) used to throw SyntaxError out of readMirror, which
    // listMirrors caught at the outer level and returned `[]` for —
    // every shared project disappeared from the user's home view.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { createMirror, listMirrors } = await import(
      "../../../server/sharedProjects/cache"
    );
    const { sharedProjectDir } = await import("../../../server/paths");

    await createMirror({
      id: "good",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });

    const badDir = sharedProjectDir("bad");
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(path.join(badDir, "metadata.json"), "");

    const list = await listMirrors();
    expect(list.map((m) => m.id)).toEqual(["good"]);
  });

  it("deleteMirror removes the directory", async () => {
    const { createMirror, deleteMirror, readMirror } = await import(
      "../../../server/sharedProjects/cache"
    );
    await createMirror({
      id: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    await deleteMirror("abc");
    const m = await readMirror("abc");
    expect(m).toBeNull();
  });
});
