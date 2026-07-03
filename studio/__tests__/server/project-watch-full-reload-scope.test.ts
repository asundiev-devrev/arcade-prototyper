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

/**
 * Server stub with a minimal Vite moduleGraph that records which files were
 * invalidated. Each file maps to one module node; an `importedBy` map lets a
 * test assert importers are invalidated too (the index.tsx → ./sibling case).
 */
function setupServerStubWithModuleGraph(importedBy: Record<string, string[]> = {}) {
  const sent: Array<{ type: string; path: string }> = [];
  const invalidated: string[] = [];
  const nodeFor = (file: string): any => ({
    file,
    importers: new Set((importedBy[file] ?? []).map((f) => nodeFor(f))),
  });
  const server = {
    ws: { send: (msg: { type: string; path: string }) => sent.push(msg) },
    moduleGraph: {
      getModulesByFile: (file: string) => new Set([nodeFor(file)]),
      invalidateModule: (mod: { file: string }) => invalidated.push(mod.file),
    },
  };
  return { server, sent, invalidated };
}

describe("projectWatchPlugin full-reload scope", () => {
  it("broadcasts full-reload for frame-dir source writes, not scaffold writes", async () => {
    const { server, sent } = setupServerStub();
    const plugin = projectWatchPlugin();
    plugin.configureServer!.call({} as never, server as never);
    expect(fakeWatcher.handler).toBeTruthy();

    const slug = "p-handoff";
    await fs.mkdir(path.join(TMP_ROOT, slug, "shared"), { recursive: true });
    await fs.mkdir(path.join(TMP_ROOT, slug, "frames", "f1"), {
      recursive: true,
    });

    // Scaffold writes — must NOT trigger full-reload (they raced the chat POST
    // in the 0.23.6 regression; theme-overrides.css HMRs on its own).
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

  it("broadcasts full-reload when an ejected sibling module is written to a frame dir", async () => {
    // Regression for the eject workflow: the agent writes index.tsx (with
    // `import { ComputerScene } from "./ComputerScene"`) a beat BEFORE it copies
    // ComputerScene.tsx next to it. index.tsx's resolution of ./ComputerScene
    // failed and Vite cached the miss; reloading only on index.tsx left the
    // "[vite:import-analysis] Failed to resolve ./ComputerScene" overlay stuck
    // until a manual restart. A sibling .tsx write must also reload so the
    // arrival re-runs resolution.
    const { server, sent } = setupServerStub();
    const plugin = projectWatchPlugin();
    plugin.configureServer!.call({} as never, server as never);

    const slug = "p-eject";
    await fs.mkdir(path.join(TMP_ROOT, slug, "frames", "f1"), { recursive: true });

    await fakeWatcher.handler!(
      "add",
      path.join(TMP_ROOT, slug, "frames", "f1", "ComputerScene.tsx"),
    );
    expect(sent).toEqual([{ type: "full-reload", path: "*" }]);
  });

  it("invalidates the written file AND its importer (index.tsx) in the module graph", async () => {
    // The real bug behind the eject failure: `full-reload` only re-runs the
    // CLIENT, but Vite caches import resolution on the SERVER — so index.tsx's
    // failed `./ComputerScene` resolution replayed as a transform error even
    // after the sibling landed on disk, until the module node was invalidated.
    // A fresh module id / client reload was NOT enough (verified live). The
    // watcher must evict the written file + its importers from the module graph
    // so the next request re-resolves. This pins that server-side eviction.
    const slug = "p-eject-mg";
    const frameDir = path.join(TMP_ROOT, slug, "frames", "f1");
    const siblingPath = path.join(frameDir, "ComputerScene.tsx");
    const indexPath = path.join(frameDir, "index.tsx");
    const { server, invalidated } = setupServerStubWithModuleGraph({
      // The ejected sibling is imported by index.tsx (the holder of the stale
      // negative resolution).
      [siblingPath]: [indexPath],
    });
    const plugin = projectWatchPlugin();
    plugin.configureServer!.call({} as never, server as never);
    await fs.mkdir(frameDir, { recursive: true });

    await fakeWatcher.handler!("add", siblingPath);

    // The written sibling was invalidated…
    expect(invalidated).toContain(siblingPath);
    // …AND its importer index.tsx (where the cached `./ComputerScene` miss lived).
    expect(invalidated).toContain(indexPath);
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
