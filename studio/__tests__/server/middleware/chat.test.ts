// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chatMiddleware } from "../../../server/middleware/chat";
import { createProject, readHistory } from "../../../server/projects";
import { __resetTurnRegistryForTests } from "../../../server/turnRegistry";
import { SCOPED_EDIT_MARKER } from "../../../src/lib/scopedEdit";

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

  it("returns 400 (not a 500 crash) when prompt is missing", async () => {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "demo" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns 400 when slug is missing", async () => {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when images is not an array of strings", async () => {
    const p = await createProject({ name: "ImgVal", theme: "arcade", mode: "light" });
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug, prompt: "hi", images: [1, 2, 3] }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when displayPrompt is not a string", async () => {
    const p = await createProject({ name: "DispVal", theme: "arcade", mode: "light" });
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug, prompt: "hi", displayPrompt: 42 }),
    });
    expect(res.status).toBe(400);
  });

  // The scoped-edit leak fix: the client sends the FULL prompt (hidden targeting
  // preamble + the words the user typed) plus a separate `displayPrompt` (just
  // the typed words). The agent must get the full prompt (routing reads the
  // marker), but the user must NEVER see the preamble — so BOTH the persisted
  // history and the SSE turn header carry only the clean text.
  it("persists the clean displayPrompt (not the hidden preamble) and echoes it in the turn header", async () => {
    const p = await createProject({ name: "Scoped", theme: "arcade", mode: "light" });
    const typed = "make this button open a filter popover";
    const fullPrompt = `${SCOPED_EDIT_MARKER}\n\nTarget element:\n- <Button> at frames/x/index.tsx:42\n\n${typed}`;
    const post = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug, prompt: fullPrompt, displayPrompt: typed }),
    });
    expect(post.status).toBe(202);

    const stream = await drainStream(p.slug);
    // The turn header carries the CLEAN text and hides the machine preamble.
    const header = stream
      .split("\n")
      .find((l) => l.startsWith("data:") && l.includes('"kind":"turn"'));
    expect(header).toBeTruthy();
    const parsed = JSON.parse(header!.replace(/^data:\s*/, ""));
    expect(parsed.displayPrompt).toBe(typed);
    expect(parsed.displayPrompt).not.toContain(SCOPED_EDIT_MARKER);
    expect(parsed.displayPrompt).not.toContain("Target element:");

    // Persisted history shows only what the user typed.
    const history = await readHistory(p.slug);
    const userMsg = history.find((m) => m.role === "user");
    expect(userMsg?.content).toBe(typed);
    expect(userMsg?.content).not.toContain(SCOPED_EDIT_MARKER);
  });

  it("falls back to the full prompt for an ordinary turn (no displayPrompt sent)", async () => {
    const p = await createProject({ name: "Plain", theme: "arcade", mode: "light" });
    const post = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug, prompt: "build me a dashboard" }),
    });
    expect(post.status).toBe(202);
    await drainStream(p.slug);
    const history = await readHistory(p.slug);
    expect(history.find((m) => m.role === "user")?.content).toBe("build me a dashboard");
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
