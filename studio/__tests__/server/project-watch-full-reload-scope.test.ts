// Regression for 0.23.6 (second-pass): the projectWatchPlugin file watcher
// used to broadcast `full-reload` on every .tsx/.ts/.css change under
// `projects/`. createProject scaffolding writes `theme-overrides.css` +
// `shared/devrev.ts` as the user navigates into the new project from the
// home hero — those writes raced the route's `POST /api/chat` and the
// reload tore the request down before the server had registered the turn.
// Symptom: dead chat window, "Working…" never paints, frame eventually
// appears via independent reconcile.
//
// This test pins the post-fix scope: full-reload fires ONLY for
// `<slug>/frames/<frameId>/index.tsx` writes; scaffold-time writes
// (theme-overrides.css, shared/*.ts, CLAUDE.md, project.json,
// chat-history.json) do not broadcast a reload.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { projectWatchPlugin } from "../../server/plugins/projectWatchPlugin";

vi.mock("../../server/projects", () => ({
  reconcileFrames: vi.fn(async () => {}),
}));

vi.mock("../../server/middleware/chatRelayMirror", () => ({
  recordChatEventForReplay: vi.fn(),
}));

vi.mock("../../server/secrets/keychain", () => ({
  getDevRevPat: vi.fn(async () => null),
}));

vi.mock("../../server/relay/auth", () => ({
  resolveDevuFromPat: vi.fn(async () => null),
}));

let TMP_ROOT = "";
vi.mock("../../server/paths", () => ({
  projectsRoot: () => TMP_ROOT,
}));

interface Handler {
  (event: string, filePath: string): Promise<void> | void;
}

interface FakeWatcher {
  handler: Handler | null;
  on(_event: "all", h: Handler): FakeWatcher;
  close(): Promise<void>;
}

const fakeWatcher: FakeWatcher = {
  handler: null,
  on(_event, h) {
    this.handler = h;
    return this;
  },
  async close() {},
};

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => fakeWatcher),
  },
}));

beforeEach(async () => {
  TMP_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "studio-watch-test-"));
  fakeWatcher.handler = null;
});

afterEach(async () => {
  if (TMP_ROOT) {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
    TMP_ROOT = "";
  }
});

function setupServerStub() {
  const sent: Array<{ type: string; path: string }> = [];
  const server = {
    ws: {
      send: (msg: { type: string; path: string }) => {
        sent.push(msg);
      },
    },
  };
  return { server, sent };
}

describe("projectWatchPlugin full-reload scope", () => {
  it("broadcasts full-reload only for frames/<id>/index.tsx writes", async () => {
    const { server, sent } = setupServerStub();
    const plugin = projectWatchPlugin();
    plugin.configureServer!.call({} as never, server as never);
    expect(fakeWatcher.handler).toBeTruthy();

    const slug = "p-handoff";
    await fs.mkdir(path.join(TMP_ROOT, slug, "shared"), { recursive: true });
    await fs.mkdir(path.join(TMP_ROOT, slug, "frames", "f1"), {
      recursive: true,
    });

    // Scaffold writes — must NOT trigger full-reload.
    const scaffoldPaths = [
      path.join(TMP_ROOT, slug, "theme-overrides.css"),
      path.join(TMP_ROOT, slug, "shared", "devrev.ts"),
      path.join(TMP_ROOT, slug, "CLAUDE.md"),
      path.join(TMP_ROOT, slug, "project.json"),
      path.join(TMP_ROOT, slug, "chat-history.json"),
    ];
    for (const p of scaffoldPaths) {
      await fakeWatcher.handler!("add", p);
    }
    expect(sent).toEqual([]);

    // Frame index write — MUST trigger full-reload.
    await fakeWatcher.handler!(
      "add",
      path.join(TMP_ROOT, slug, "frames", "f1", "index.tsx"),
    );
    expect(sent).toEqual([{ type: "full-reload", path: "*" }]);
  });

  it("ignores writes outside a valid project slug directory", async () => {
    const { server, sent } = setupServerStub();
    const plugin = projectWatchPlugin();
    plugin.configureServer!.call({} as never, server as never);

    // Path with invalid slug pattern (uppercase + underscore).
    await fakeWatcher.handler!(
      "add",
      path.join(TMP_ROOT, "_NotASlug", "frames", "f1", "index.tsx"),
    );
    expect(sent).toEqual([]);
  });
});
