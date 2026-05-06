// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chatMiddleware } from "../../../server/middleware/chat";
import { createProject } from "../../../server/projects";
import { __resetTurnRegistryForTests } from "../../../server/turnRegistry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAKE = path.join(__dirname, "../../fixtures/fake-claude.sh");

let tmp: string; let server: http.Server; let port: number;

beforeAll(() => fs.chmodSync(FAKE, 0o755));

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-chat-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE;
  process.env.ARCADE_STUDIO_SKIP_SSO_CHECK = "1";
  __resetTurnRegistryForTests();
  server = http.createServer(chatMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  __resetTurnRegistryForTests();
  delete process.env.ARCADE_STUDIO_ROOT;
  delete process.env.ARCADE_STUDIO_CLAUDE_BIN;
  delete process.env.ARCADE_STUDIO_SKIP_SSO_CHECK;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Consume the SSE stream for `slug` until it closes. Returns the full body. */
async function drainStream(slug: string): Promise<string> {
  const res = await fetch(`http://localhost:${port}/api/chat/stream/${slug}`);
  return res.text();
}

describe("POST /api/chat", () => {
  it("starts a turn and returns 202 with a turn id", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug, prompt: "hi" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.slug).toBe(p.slug);
    expect(typeof body.turnId).toBe("string");

    // Drain the stream so the fake claude subprocess completes before we
    // read the persisted project.json (otherwise the `updateProject` race
    // can miss the sessionId write on slow CI).
    const stream = await drainStream(p.slug);
    expect(stream).toContain("event: turn");
    expect(stream).toContain("event: session");
    expect(stream).toContain("event: narration");
    expect(stream).toContain("event: end");

    const saved = JSON.parse(fs.readFileSync(path.join(tmp, "projects", p.slug, "project.json"), "utf-8"));
    expect(saved.sessionId).toBe("sess-001");
  });

  it("returns 404 when the slug doesn't exist", async () => {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "ghost", prompt: "hi" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/chat/stream/:slug", () => {
  it("emits an idle frame when no turn is running for the slug", async () => {
    const p = await createProject({ name: "Idle", theme: "arcade", mode: "light" });
    const body = await drainStream(p.slug);
    expect(body).toContain("event: idle");
    expect(body).not.toContain("event: turn");
  });

  it("replays buffered events when a late subscriber joins after the turn ends", async () => {
    const p = await createProject({ name: "Replay", theme: "arcade", mode: "light" });
    const post = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug, prompt: "hi" }),
    });
    expect(post.status).toBe(202);

    // Wait for the turn to finish by draining the stream once.
    const first = await drainStream(p.slug);
    expect(first).toContain("event: end");

    // A second subscriber must see the same events replayed from the
    // registry — this is what makes page refresh mid-turn work.
    const replay = await drainStream(p.slug);
    expect(replay).toContain("event: turn");
    expect(replay).toContain("event: narration");
    expect(replay).toContain("event: end");
  });
});
