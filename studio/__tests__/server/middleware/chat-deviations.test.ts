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
const FAKE_NO = path.join(__dirname, "../../fixtures/fake-claude-no-deviations.sh");
const FAKE_YES = path.join(__dirname, "../../fixtures/fake-claude-with-deviations.sh");

let tmp: string; let server: http.Server; let port: number;

beforeAll(() => {
  fs.chmodSync(FAKE_NO, 0o755);
  fs.chmodSync(FAKE_YES, 0o755);
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-deviations-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
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

async function drainStream(slug: string): Promise<string> {
  const res = await fetch(`http://localhost:${port}/api/chat/stream/${slug}`);
  return res.text();
}

async function startTurnAndDrain(slug: string): Promise<string> {
  const post = await fetch(`http://localhost:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, prompt: "go" }),
  });
  expect(post.status).toBe(202);
  return drainStream(slug);
}

describe("deviations contract enforcement", () => {
  it("appends a warning trailer when the agent omits ### Deviations", async () => {
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_NO;
    const p = await createProject({ name: "No Dev", theme: "arcade", mode: "light" });

    const stream = await startTurnAndDrain(p.slug);

    // The synthetic narration must appear in the SSE stream so the live UI
    // sees the warning.
    expect(stream).toContain("### Deviations");
    expect(stream).toContain("Agent did not emit a Deviations section");

    // AND it must be persisted to chat history so the warning survives reload.
    const historyPath = path.join(tmp, "projects", p.slug, "chat-history.json");
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const assistant = history.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.content).toMatch(/### Deviations/);
    expect(assistant.content).toMatch(/Agent did not emit a Deviations section/);
  });

  it("passes through unchanged when the agent emits ### Deviations", async () => {
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_YES;
    const p = await createProject({ name: "Has Dev", theme: "arcade", mode: "light" });

    const stream = await startTurnAndDrain(p.slug);

    // The stream contains ONE copy of the Deviations heading (the agent's),
    // not two (agent's + trailer's).
    const matches = stream.match(/### Deviations/g) ?? [];
    expect(matches.length).toBe(1);
    expect(stream).not.toContain("Agent did not emit a Deviations section");

    const historyPath = path.join(tmp, "projects", p.slug, "chat-history.json");
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const assistant = history.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.content).toMatch(/### Deviations\n\nNone\./);
    expect(assistant.content).not.toMatch(/Agent did not emit/);
  });
});
