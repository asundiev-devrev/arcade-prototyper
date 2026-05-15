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
