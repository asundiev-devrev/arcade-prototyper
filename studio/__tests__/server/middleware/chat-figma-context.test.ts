// @vitest-environment node
//
// Routing contract for Figma-URL prompts.
//
// HISTORY: until 2026-06-12 a Figma URL routed to the Claude generator with
// an injected <figma_context> block, and a separate hi-fi-intent gate picked
// a transpile branch. Both are gone: ANY prompt with a Figma URL (that isn't
// a @Computer turn) now routes to the deterministic kit-emit branch
// (server/figma/kitEmitBranch.ts) — no LLM, no Bedrock auth, no claude
// subprocess. These tests pin that routing.
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createProject } from "../../../server/projects";
import { __resetTurnRegistryForTests } from "../../../server/turnRegistry";

const kitEmitSpy = vi.hoisted(() =>
  vi.fn(async (input: any) => {
    input.emit({ kind: "narration", text: "Importing the Figma design (stub)…" });
    return { ok: true };
  }),
);
vi.mock("../../../server/figma/kitEmitBranch", () => ({
  runFigmaKitEmitBranch: kitEmitSpy,
}));

// Import AFTER the mock so chat.ts binds the stub.
import { chatMiddleware } from "../../../server/middleware/chat";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAKE = path.join(__dirname, "../../fixtures/fake-claude.sh");

let tmp: string; let server: http.Server; let port: number;

beforeAll(() => fs.chmodSync(FAKE, 0o755));

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-chat-fig-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE;
  process.env.ARCADE_STUDIO_SKIP_SSO_CHECK = "1";
  process.env.ARCADE_TEST_PROMPT_OUT = path.join(tmp, "last-prompt.txt");
  kitEmitSpy.mockClear();
  __resetTurnRegistryForTests();
  server = http.createServer(chatMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  __resetTurnRegistryForTests();
  vi.restoreAllMocks();
  delete process.env.ARCADE_STUDIO_ROOT;
  delete process.env.ARCADE_STUDIO_CLAUDE_BIN;
  delete process.env.ARCADE_STUDIO_SKIP_SSO_CHECK;
  delete process.env.ARCADE_TEST_PROMPT_OUT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Drain the per-slug SSE stream so the turn completes before assertions. */
async function drainStream(slug: string): Promise<string> {
  const r = await fetch(`http://localhost:${port}/api/chat/stream/${slug}`);
  return r.text();
}

async function post(slug: string, prompt: string) {
  return fetch(`http://localhost:${port}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, prompt }),
  });
}

describe("/api/chat Figma-URL routing (kit-emit branch)", () => {
  it("routes ANY prompt with a Figma URL to the kit-emit branch — no claude spawn", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await post(p.slug, "build this https://www.figma.com/design/k/x?node-id=1-2");
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    expect(kitEmitSpy).toHaveBeenCalledTimes(1);
    const input = kitEmitSpy.mock.calls[0][0];
    expect(input.fileKey).toBe("k");
    expect(input.nodeId).toBe("1:2");
    expect(input.slug).toBe(p.slug);
    // The claude subprocess never ran: the fake bin writes its argv to
    // ARCADE_TEST_PROMPT_OUT, which must not exist.
    expect(fs.existsSync(process.env.ARCADE_TEST_PROMPT_OUT!)).toBe(false);
  });

  it("does NOT require hi-fi phrasing — a bare URL is enough", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await post(p.slug, "https://www.figma.com/design/abc/file?node-id=3-4");
    expect(res.status).toBe(202);
    await drainStream(p.slug);
    expect(kitEmitSpy).toHaveBeenCalledTimes(1);
    expect(kitEmitSpy.mock.calls[0][0].nodeId).toBe("3:4");
  });

  it("skips Bedrock auth pre-check for kit-emit turns (no LLM involved)", async () => {
    // Without SKIP_SSO_CHECK the Claude path would fail fast on missing
    // Bedrock auth; the kit-emit branch must not be gated on it.
    delete process.env.ARCADE_STUDIO_SKIP_SSO_CHECK;
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await post(p.slug, "import https://www.figma.com/design/k/x?node-id=1-2");
    expect(res.status).toBe(202);
    const stream = await drainStream(p.slug);
    expect(kitEmitSpy).toHaveBeenCalledTimes(1);
    expect(stream).not.toContain("No Bedrock auth detected");
  });

  it("prompt WITHOUT a Figma URL still takes the claude branch", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await post(p.slug, "build a settings page");
    expect(res.status).toBe(202);
    await drainStream(p.slug);
    expect(kitEmitSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.ARCADE_TEST_PROMPT_OUT!)).toBe(true);
  });

  it("kit-emit narration is forwarded on the SSE stream", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    await post(p.slug, "https://www.figma.com/design/k/x?node-id=1-2");
    const stream = await drainStream(p.slug);
    expect(stream).toContain("Importing the Figma design (stub)");
  });
});
