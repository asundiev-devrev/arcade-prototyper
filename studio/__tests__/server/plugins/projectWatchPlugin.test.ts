import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";

// Track every recordChatEventForReplay call so we can assert mirror behavior.
const mirrored: Array<{ ref: any; ev: any }> = [];

vi.mock("../../../server/middleware/chatRelayMirror", () => ({
  recordChatEventForReplay: (ref: any, ev: any) => {
    mirrored.push({ ref, ev });
  },
}));

// Pretend the host PAT resolves to a known devu without hitting the network.
vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: async () => "fake-pat",
}));
vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async () => ({ id: "devu/host", displayName: "Host" }),
}));

// reconcileFrames touches a lot of state we don't care about here.
vi.mock("../../../server/projects", () => ({
  reconcileFrames: vi.fn(async () => {}),
}));

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-pw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  fs.mkdirSync(path.join(tmp, "projects", "myproj", "frames"), { recursive: true });
  mirrored.length = 0;
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("projectWatchPlugin multiplayer mirror", () => {
  // Chokidar fires events asynchronously after its initial scan completes.
  // Vite's `configureServer` returns synchronously, so we have to give the
  // watcher a beat after `server.listen` before mutating files; otherwise
  // writes can happen during the initial scan and get swallowed.
  const SETTLE_MS = 800;

  it("mirrors frame index.tsx writes to the relay as frame_written", async () => {
    // Import after mocks + env are set so the plugin reads our temp root.
    const { projectWatchPlugin } = await import(
      "../../../server/plugins/projectWatchPlugin"
    );
    const server = await createServer({
      configFile: false,
      plugins: [projectWatchPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    try {
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const frameDir = path.join(tmp, "projects", "myproj", "frames", "frame-01");
      await fsp.mkdir(frameDir, { recursive: true });
      await fsp.writeFile(path.join(frameDir, "index.tsx"), "export default () => <div/>;");

      await waitFor(() => mirrored.some((m) => m.ev.type === "frame_written"), 8000);
      const writeEv = mirrored.find((m) => m.ev.type === "frame_written")!;
      expect(writeEv.ref).toEqual({ hostDevu: "devu/host", projectSlug: "myproj" });
      expect(writeEv.ev.path).toBe("frame-01");
      expect(writeEv.ev.content).toContain("export default");
      expect(typeof writeEv.ev.turnId).toBe("string");
      expect(writeEv.ev.turnId.startsWith("file-watch-")).toBe(true);
    } finally {
      await server.close();
    }
  }, 15000);

  it("mirrors frame index.tsx unlink as frame_deleted", async () => {
    const { projectWatchPlugin } = await import(
      "../../../server/plugins/projectWatchPlugin"
    );
    const frameDir = path.join(tmp, "projects", "myproj", "frames", "frame-02");
    fs.mkdirSync(frameDir, { recursive: true });
    fs.writeFileSync(path.join(frameDir, "index.tsx"), "export default () => null;");

    const server = await createServer({
      configFile: false,
      plugins: [projectWatchPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    try {
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      await fsp.unlink(path.join(frameDir, "index.tsx"));
      await waitFor(() => mirrored.some((m) => m.ev.type === "frame_deleted"), 8000);
      const delEv = mirrored.find((m) => m.ev.type === "frame_deleted")!;
      expect(delEv.ref).toEqual({ hostDevu: "devu/host", projectSlug: "myproj" });
      expect(delEv.ev.path).toBe("frame-02");
    } finally {
      await server.close();
    }
  }, 15000);

  it("does not mirror non-frame file writes", async () => {
    const { projectWatchPlugin } = await import(
      "../../../server/plugins/projectWatchPlugin"
    );
    const server = await createServer({
      configFile: false,
      plugins: [projectWatchPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    try {
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      // Top-level project file — should reconcile/reload but never mirror.
      await fsp.writeFile(
        path.join(tmp, "projects", "myproj", "theme-overrides.css"),
        ":root{}",
      );
      // Give chokidar a beat to fire.
      await new Promise((r) => setTimeout(r, 800));
      expect(mirrored.filter((m) => m.ev.type === "frame_written")).toHaveLength(0);
    } finally {
      await server.close();
    }
  }, 15000);
});
