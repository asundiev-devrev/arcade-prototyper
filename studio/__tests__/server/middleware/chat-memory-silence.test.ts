// @vitest-environment node
//
// Regression: memory capture is SILENT.
//
// The CLAUDE.md response shape now asks the agent for a `⟐ remember:` line and
// promises it "is stripped before the designer sees your reply". Because
// refreshStaleClaudeMd() rewrites every existing project's CLAUDE.md on boot,
// that prompt goes live the moment the template ships — so the stripper has to
// be live at the same commit, or the plumbing line reaches the chat pane and
// chat-history.json.
//
// The static assertions in claude-md-memory-capture.test.ts prove the wiring
// EXISTS; this file proves it WORKS, by running a real turn against a fake
// claude that emits the sentinel.
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chatMiddleware } from "../../../server/middleware/chat";
import { createProject } from "../../../server/projects";
import { __resetTurnRegistryForTests } from "../../../server/turnRegistry";
import { MEMORY_SENTINEL } from "../../../server/memoryContract";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_MEMORY = path.join(__dirname, "../../fixtures/fake-claude-memory-line.sh");

let tmp: string;
let server: http.Server;
let port: number;

beforeAll(() => {
  fs.chmodSync(FAKE_MEMORY, 0o755);
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-mem-silence-"));
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

async function runTurn(slug: string): Promise<string> {
  const post = await fetch(`http://localhost:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, prompt: "go" }),
  });
  expect(post.status).toBe(202);
  const res = await fetch(`http://localhost:${port}/api/chat/stream/${slug}`);
  return res.text();
}

describe("memory capture is silent end-to-end", () => {
  it("never leaks the sentinel to the live stream or the persisted history", async () => {
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_MEMORY;
    const p = await createProject({ name: "Mem Silence", theme: "arcade", mode: "light" });

    const stream = await runTurn(p.slug);

    // The chat pane: no sentinel, no glyph, and none of the fact text — an
    // ActivityRow rendering "project | Filter chips go in the toolbar" would be
    // plumbing on screen.
    expect(stream).not.toContain(MEMORY_SENTINEL);
    expect(stream).not.toContain("⟐");
    expect(stream).not.toContain("Filter chips go in the toolbar");
    expect(stream).not.toContain("Active nav rows use neutral gray");
    expect(stream).not.toContain("the preference, one short sentence");

    // The designer's actual reply survives intact around the removed line.
    expect(stream).toContain("Built the settings page.");
    expect(stream).toContain("### Deviations");

    // The persisted history: same contract, or the line reappears on reload.
    const historyPath = path.join(tmp, "projects", p.slug, "chat-history.json");
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const assistant = history.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.content).not.toContain(MEMORY_SENTINEL);
    expect(assistant.content).not.toContain("⟐");
    expect(assistant.content).not.toContain("Filter chips go in the toolbar");
    expect(assistant.content).toContain("Built the settings page.");
  });

  it("does not fire the missing-Deviations trailer because of a stripped line", async () => {
    // The turn DID contain a Deviations section; stripping must not disturb the
    // contract check that reads the same narration.
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_MEMORY;
    const p = await createProject({ name: "Mem Dev", theme: "arcade", mode: "light" });

    const stream = await runTurn(p.slug);

    expect(stream).not.toContain("Agent did not emit a Deviations section");
    expect((stream.match(/### Deviations/g) ?? []).length).toBe(1);
  });

  it("leaves no empty assistant bubble for a memory-only message", async () => {
    // The fixture's 2nd and 3rd messages are nothing BUT a sentinel line. If
    // those were emitted as empty narration, the designer would see blank rows.
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_MEMORY;
    const p = await createProject({ name: "Mem Empty", theme: "arcade", mode: "light" });

    const stream = await runTurn(p.slug);

    for (const line of stream.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      let ev: any;
      try {
        ev = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (ev?.kind === "narration") expect(ev.text.trim()).not.toBe("");
    }
  });
});
