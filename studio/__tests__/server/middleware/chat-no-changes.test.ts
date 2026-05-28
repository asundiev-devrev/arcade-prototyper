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

// Three fixtures cover the matrix:
// - no Deviations + no edit  → both trailers
// - has Deviations + no edit → no-changes trailer only (the case the user
//   reported: agent says "I split it" but nothing happens)
// - has Deviations + edit    → no trailer (the happy path)
const FIXTURE_NO_CHANGES = path.join(__dirname, "../../fixtures/fake-claude-no-changes.sh");
const FIXTURE_WITH_EDIT = path.join(__dirname, "../../fixtures/fake-claude-with-deviations.sh");

let tmp: string;
let server: http.Server;
let port: number;

beforeAll(() => {
  fs.chmodSync(FIXTURE_NO_CHANGES, 0o755);
  fs.chmodSync(FIXTURE_WITH_EDIT, 0o755);
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-no-changes-"));
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

async function startTurnAndDrain(slug: string): Promise<string> {
  const post = await fetch(`http://localhost:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, prompt: "split the skill list into two columns" }),
  });
  expect(post.status).toBe(202);
  const res = await fetch(`http://localhost:${port}/api/chat/stream/${slug}`);
  return res.text();
}

describe("no-frame-changes contract enforcement", () => {
  it("appends a 'no frame changes' warning when the agent narrates a change but writes no file", async () => {
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FIXTURE_NO_CHANGES;
    const p = await createProject({ name: "Unchanged", theme: "arcade", mode: "light" });

    const stream = await startTurnAndDrain(p.slug);

    expect(stream).toContain("Studio detected no frame changes this turn");

    const historyPath = path.join(tmp, "projects", p.slug, "chat-history.json");
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const assistant = history.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.content).toMatch(/Studio detected no frame changes this turn/);
  });

  it("does NOT fire the warning when the agent actually writes a frame file", async () => {
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FIXTURE_WITH_EDIT;
    const p = await createProject({ name: "Changed", theme: "arcade", mode: "light" });

    const stream = await startTurnAndDrain(p.slug);

    expect(stream).not.toContain("Studio detected no frame changes this turn");

    const historyPath = path.join(tmp, "projects", p.slug, "chat-history.json");
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const assistant = history.find((m: { role: string }) => m.role === "assistant");
    expect(assistant.content).not.toMatch(/Studio detected no frame changes/);
  });
});
