// @vitest-environment node
//
// Regression for 0.23.x: spectator comments posted into the host's chat
// pane were broadcast through the relay but never landed in the host's
// `<projectsRoot>/<slug>/chat-history.json`. The host studio's chat pane
// stayed empty and a reload lost the comment entirely.
//
// `attachHostCommentInbox(hostDevu)` subscribes to the global project bus
// and persists `comment_posted` events into the host's chat-history.json
// (idempotent on `comment:<id>`).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  __resetProjectRegistryForTests,
  createOrGetProject,
} from "../../../server/relay/projectRegistry";
import {
  __resetWsServerForTests,
  broadcastToProject,
  getReplayBufferForProject,
} from "../../../server/relay/wsServer";
import { attachHostCommentInbox } from "../../../server/relay/hostCommentInbox";
import { chatHistoryPath, projectDir } from "../../../server/paths";

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-comment-inbox-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  __resetProjectRegistryForTests();
  __resetWsServerForTests();
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function flush(): Promise<void> {
  // hostCommentInbox.persistComment is fire-and-forget; let microtasks run.
  await new Promise((r) => setTimeout(r, 10));
}

function seedHistory(slug: string, history: unknown[]): void {
  const dir = projectDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(chatHistoryPath(slug), JSON.stringify(history, null, 2));
}

describe("attachHostCommentInbox", () => {
  it("persists a comment_posted event into the host's chat-history.json", async () => {
    const project = await createOrGetProject({
      hostDevu: "devu/A",
      projectSlug: "demo",
    });
    seedHistory("demo", []);
    // Prime a live session so broadcastToProject hits the bus.
    getReplayBufferForProject(project.id);

    const detach = attachHostCommentInbox("devu/A");

    broadcastToProject(project.id, {
      type: "comment_posted",
      id: "c-1",
      byDevu: "devu/B",
      displayName: "Bob",
      text: "looks good",
      mentions: [],
      ts: 1_700_000_000_000,
    });

    await flush();
    detach();

    const history = JSON.parse(
      fs.readFileSync(chatHistoryPath("demo"), "utf-8"),
    );
    expect(history).toEqual([
      {
        id: "comment:c-1",
        role: "user",
        content: "looks good",
        createdAt: new Date(1_700_000_000_000).toISOString(),
      },
    ]);
  });

  it("dedupes by comment id (idempotent on rebroadcast)", async () => {
    const project = await createOrGetProject({
      hostDevu: "devu/A",
      projectSlug: "demo",
    });
    seedHistory("demo", []);
    getReplayBufferForProject(project.id);

    const detach = attachHostCommentInbox("devu/A");

    const ev = {
      type: "comment_posted" as const,
      id: "c-1",
      byDevu: "devu/B",
      displayName: "Bob",
      text: "hi",
      mentions: [],
      ts: 1_700_000_000_000,
    };
    broadcastToProject(project.id, ev);
    await flush();
    broadcastToProject(project.id, ev);
    await flush();
    detach();

    const history = JSON.parse(
      fs.readFileSync(chatHistoryPath("demo"), "utf-8"),
    );
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("comment:c-1");
  });

  it("ignores comments for projects belonging to a different host", async () => {
    const otherProject = await createOrGetProject({
      hostDevu: "devu/X",
      projectSlug: "theirs",
    });
    seedHistory("theirs", []);
    getReplayBufferForProject(otherProject.id);

    const detach = attachHostCommentInbox("devu/A");

    broadcastToProject(otherProject.id, {
      type: "comment_posted",
      id: "c-1",
      byDevu: "devu/B",
      displayName: "Bob",
      text: "should not land",
      mentions: [],
      ts: 1_700_000_000_000,
    });

    await flush();
    detach();

    const history = JSON.parse(
      fs.readFileSync(chatHistoryPath("theirs"), "utf-8"),
    );
    expect(history).toEqual([]);
  });

  it("bails when chat-history.json is missing (project deleted mid-flight)", async () => {
    const project = await createOrGetProject({
      hostDevu: "devu/A",
      projectSlug: "ghost",
    });
    // Note: no seedHistory call — file does not exist.
    getReplayBufferForProject(project.id);

    const detach = attachHostCommentInbox("devu/A");

    broadcastToProject(project.id, {
      type: "comment_posted",
      id: "c-1",
      byDevu: "devu/B",
      displayName: "Bob",
      text: "x",
      mentions: [],
      ts: 1_700_000_000_000,
    });

    await flush();
    detach();

    expect(fs.existsSync(chatHistoryPath("ghost"))).toBe(false);
  });

  it("appends to a non-empty history without clobbering existing messages", async () => {
    const project = await createOrGetProject({
      hostDevu: "devu/A",
      projectSlug: "demo",
    });
    seedHistory("demo", [
      {
        id: "turn-1",
        role: "assistant",
        content: "earlier message",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    getReplayBufferForProject(project.id);

    const detach = attachHostCommentInbox("devu/A");

    broadcastToProject(project.id, {
      type: "comment_posted",
      id: "c-1",
      byDevu: "devu/B",
      displayName: "Bob",
      text: "+1",
      mentions: [],
      ts: 1_700_000_000_000,
    });

    await flush();
    detach();

    const history = JSON.parse(
      fs.readFileSync(chatHistoryPath("demo"), "utf-8"),
    );
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("turn-1");
    expect(history[1].id).toBe("comment:c-1");
  });
});
