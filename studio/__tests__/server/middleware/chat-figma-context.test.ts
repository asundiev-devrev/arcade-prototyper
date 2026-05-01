// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chatMiddleware } from "../../../server/middleware/chat";
import { createProject } from "../../../server/projects";
import * as ingestModule from "../../../server/figmaIngest";

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
  // Tee everything the fake claude receives into a file so the test can assert
  // on prompt shape. The fake script is expected to write its argv to
  // ARCADE_TEST_PROMPT_OUT.
  process.env.ARCADE_TEST_PROMPT_OUT = path.join(tmp, "last-prompt.txt");
  server = http.createServer(chatMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  vi.restoreAllMocks();
  delete process.env.ARCADE_STUDIO_ROOT;
  delete process.env.ARCADE_STUDIO_CLAUDE_BIN;
  delete process.env.ARCADE_STUDIO_SKIP_SSO_CHECK;
  delete process.env.ARCADE_TEST_PROMPT_OUT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/api/chat with Figma structured context", () => {
  it("injects <figma_context> when an IngestResult is cached", async () => {
    vi.spyOn(ingestModule, "getFigmaIngest").mockResolvedValue({
      ingest: vi.fn(),
      ingestPhase1: vi.fn(),
      getCached: vi.fn().mockReturnValue({
        source: { fileKey: "k", nodeId: "1:2", url: "u", fetchedAt: "t" },
        png: null, tree: { id: "0", type: "frame", name: "App" },
        tokens: { colors: {}, typography: {}, spacing: {} },
        composites: [], diagnostics: { warnings: [] },
      }),
      getPhase1Pending: vi.fn().mockReturnValue(undefined),
    });

    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: p.slug,
        prompt: "build this https://www.figma.com/design/k/x?node-id=1-2",
      }),
    });
    await res.text();
    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf-8");
    expect(sent).toContain("<figma_context");
    expect(sent).toContain("</figma_context>");
    expect(sent).toContain("App");
  });

  it("proceeds without <figma_context> when phase 1 fails", async () => {
    vi.spyOn(ingestModule, "getFigmaIngest").mockResolvedValue({
      ingest: vi.fn(),
      // Simulate phase 1 failure (figmanage down, auth missing, etc.) —
      // chat turn should fall through cleanly and generate without context.
      ingestPhase1: vi.fn().mockResolvedValue({
        ok: false,
        reason: "figmanage unavailable",
        source: { fileKey: "k", nodeId: "1:2", url: "u" },
      }),
      getCached: vi.fn().mockReturnValue(undefined),
      getPhase1Pending: vi.fn().mockReturnValue(undefined),
    });
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: p.slug,
        prompt: "build this https://www.figma.com/design/k/x?node-id=1-2",
      }),
    });
    await res.text();
    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf-8");
    expect(sent).not.toContain("<figma_context");
  });

  it("injects phase-1-only context (composites=[]) when phase 2 is still pending", async () => {
    // Simulate the realistic case: user pastes URL, prefetch runs phase 1
    // (3–8s) and caches it with composites=[], then hits Send before phase 2
    // (~30s classifier) has finished. Turn should still attach the context —
    // just without composite hints — rather than falling through to the miss
    // path as 0.4.1 did with its 10s combined budget.
    vi.spyOn(ingestModule, "getFigmaIngest").mockResolvedValue({
      ingest: vi.fn(),
      ingestPhase1: vi.fn(),
      getCached: vi.fn().mockReturnValue({
        source: { fileKey: "k", nodeId: "1:2", url: "u", fetchedAt: "t" },
        png: null, tree: { id: "0", type: "frame", name: "Sidebar" },
        tokens: { colors: {}, typography: {}, spacing: {} },
        composites: [],
        diagnostics: { warnings: ["variables unavailable; styles left raw"] },
      }),
      getPhase1Pending: vi.fn().mockReturnValue(undefined),
    });

    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: p.slug,
        prompt: "build this https://www.figma.com/design/k/x?node-id=1-2",
      }),
    });
    await res.text();
    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf-8");
    expect(sent).toContain("<figma_context");
    expect(sent).toContain("Sidebar");
    // No suggested_composites section because composites=[] — buildFigmaContextBlock
    // omits it entirely. Just confirm it's absent so we know we're getting
    // phase-1-only content.
    expect(sent).not.toContain("suggested_composites:");
  });
});
