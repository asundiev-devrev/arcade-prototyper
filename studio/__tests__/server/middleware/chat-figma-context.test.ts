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
      getCached: vi.fn().mockReturnValue({
        source: { fileKey: "k", nodeId: "1:2", url: "u", fetchedAt: "t" },
        png: null, tree: { id: "0", type: "frame", name: "App" },
        tokens: { colors: {}, typography: {}, spacing: {} },
        composites: [], diagnostics: { warnings: [] },
      }),
      getPending: vi.fn().mockReturnValue(undefined),
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

  it("proceeds without <figma_context> on cache miss + timeout", async () => {
    vi.spyOn(ingestModule, "getFigmaIngest").mockResolvedValue({
      ingest: vi.fn(),
      getCached: vi.fn().mockReturnValue(undefined),
      getPending: vi.fn().mockReturnValue(undefined),
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
});
