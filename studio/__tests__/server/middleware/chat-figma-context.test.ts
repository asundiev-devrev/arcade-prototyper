// @vitest-environment node
//
// Routing contract for Figma-URL prompts.
//
// HISTORY: until 2026-06-12 a Figma URL routed to the Claude generator with
// an injected <figma_context> block, and a separate hi-fi-intent gate picked
// a transpile branch. From then, ANY Figma URL routed to the deterministic
// kit-emit branch — which has NO LLM and so silently dropped every
// instruction in the prompt (the "figma-import-debug" session: "implement
// precisely / modify the ComputerScene composite / make the input
// functional / apply the purple theme" shipped as a dumb pixel trace).
//
// NOW (2026-07-02): a BARE import (URL only, or "import/bring this in") still
// takes the fast deterministic kit-emit branch. A prompt that ALSO carries
// build intent — hi-fi ("implement precisely"), interaction ("click opens a
// modal"), or a build instruction (modify a composite, make it functional,
// apply a theme) — routes to the Claude generator, which reads the design as
// reference and builds to the brief. These tests pin that split.
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createProject } from "../../../server/projects";
import { __resetTurnRegistryForTests, getTurn } from "../../../server/turnRegistry";

const kitEmitSpy = vi.hoisted(() =>
  vi.fn(async (input: any) => {
    input.emit({ kind: "narration", text: "Importing the Figma design (stub)…" });
    return { ok: true };
  }),
);
vi.mock("../../../server/figma/kitEmitBranch", () => ({
  runFigmaKitEmitBranch: kitEmitSpy,
}));

// Force a deterministic Figma-digest MISS regardless of whether figmanage is
// installed/logged-in on the runner. getCached → undefined, phase-1 → not-ok.
vi.mock("../../../server/figmaIngest", () => ({
  getFigmaIngest: async () => ({
    getCached: () => undefined,
    getPhase1Pending: () => undefined,
    ingestPhase1: async () => ({ ok: false, reason: "test: forced miss", source: {} }),
    ingest: async () => ({ ok: false, reason: "test: forced miss", source: {} }),
  }),
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
  const text = await r.text();

  // Wait deterministically for the turn to reach terminal status before returning.
  // Under heavy parallel CPU load, the SSE stream can close before all turn writes
  // have settled. Poll getTurn(slug) until status is not "running", with a bounded
  // timeout so a hung turn still fails fast.
  const maxWaitMs = 3000;
  const tickMs = 10;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const turn = getTurn(slug);
    if (!turn || turn.status !== "running") {
      // Yield additional time to allow any trailing fs writes to flush
      // and subprocesses to fully exit before cleanup. Under heavy parallel
      // CPU load, subprocess exit and file writes can lag behind the turn's
      // terminal transition.
      await new Promise(r => setTimeout(r, 100));
      break;
    }
    await new Promise(r => setTimeout(r, tickMs));
  }

  return text;
}

async function post(slug: string, prompt: string) {
  return fetch(`http://localhost:${port}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, prompt }),
  });
}

describe("/api/chat Figma-URL routing (kit-emit branch)", () => {
  it("routes a bare-import Figma prompt to the kit-emit branch — no claude spawn", async () => {
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

  it("routes a build-intent Figma brief to the claude generator, NOT the importer", async () => {
    // The exact regression from the "figma-import-debug" session: a precise,
    // instruction-heavy brief must reach the LLM (which reads the design as
    // reference and honours the instructions), not the pixel-tracing importer.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const brief =
      "Implement this design precisely. Modify the ComputerScene composite " +
      "instead of building from scratch. The full-screen input must be " +
      "functional. Apply the purple theme to all of the UI, including canvas " +
      "and side nav. https://www.figma.com/design/k/x?node-id=1-2";
    const res = await post(p.slug, brief);
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    // Importer never ran; the claude subprocess did (wrote its argv out).
    expect(kitEmitSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.ARCADE_TEST_PROMPT_OUT!)).toBe(true);
  });

  it("a SCOPED EDIT that references Figma URLs stays an in-place edit — no new frame", async () => {
    // The regression: the user right-clicked an element (so the client prepended
    // the "Target element:" preamble), then asked to make it open a popover,
    // referencing two Figma nodes. That has interaction intent + 2 URLs, which
    // used to route to the wire branch → imported url[0] as a SEPARATE frame.
    // A scoped edit must reach the claude edit branch instead: the URLs are
    // reference, the change happens in the picked frame. So the importer must
    // NOT run, and claude must (writes its argv out).
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const prompt =
      'Target element: <Button> "All Knowledge"\n' +
      "Placed at frames/01-figma-8139-41293/index.tsx:39:247\n\n" +
      'Make "All Knowledge" work as a filter that opens a popover menu when clicked. ' +
      "Popover looks like https://www.figma.com/design/k/x?node-id=8172-33651 " +
      "and the menu like https://www.figma.com/design/k/x?node-id=8140-33699";
    const res = await post(p.slug, prompt);
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    // Importer never ran (no separate frame stamped); the claude edit branch did.
    expect(kitEmitSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.ARCADE_TEST_PROMPT_OUT!)).toBe(true);
  });

  it("does NOT require hi-fi phrasing — a bare URL is enough", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await post(p.slug, "https://www.figma.com/design/abc/file?node-id=3-4");
    expect(res.status).toBe(202);
    await drainStream(p.slug);
    expect(kitEmitSpy).toHaveBeenCalledTimes(1);
    expect(kitEmitSpy.mock.calls[0][0].nodeId).toBe("3:4");
  });

  it("routes a PURE hi-fi prompt (no build/interaction verb) to the kit-emit branch", async () => {
    // "implement precisely" with a URL and no build/interaction instruction is a
    // faithful-reproduction ask — it must take the deterministic engine, not the
    // LLM reconstructor. This is the core figma-import-v2 routing flip.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await post(
      p.slug,
      "Implement this precisely https://www.figma.com/design/k/x?node-id=1-2",
    );
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    expect(kitEmitSpy).toHaveBeenCalledTimes(1);
    expect(kitEmitSpy.mock.calls[0][0].nodeId).toBe("1:2");
    // Claude never ran: the fake bin writes argv to ARCADE_TEST_PROMPT_OUT.
    expect(fs.existsSync(process.env.ARCADE_TEST_PROMPT_OUT!)).toBe(false);
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

describe("hi-fi directive survives a Figma digest miss", () => {
  it("appends <high_fidelity_mode> even when no digest/PNG is available", async () => {
    // Ingest is mocked to miss (above). A prompt that reaches the LLM (build
    // intent) AND carries hi-fi wording must STILL carry the directive on a
    // digest miss — the defect-A regression guard. NB: pure-hi-fi prompts now
    // route to kit-emit (see the separate routing test below); the directive
    // guarantee applies to prompts that legitimately reach the generator.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const prompt =
      "Implement this precisely and make the input functional " +
      "https://www.figma.com/design/k/x?node-id=1-2";
    const res = await post(p.slug, prompt);
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf8");
    expect(sent).toContain("<high_fidelity_mode>");
  });

  it("emits the precise-mode narration on a hi-fi turn (the wider-budget branch)", async () => {
    // Proves the hi-fi BRANCH is taken end-to-end for a prompt that reaches the
    // generator. Budget VALUE is pinned separately in digest-race-budget.test.ts.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const stream = await (async () => {
      await post(
        p.slug,
        "Implement this precisely and make the input functional " +
          "https://www.figma.com/design/k/x?node-id=1-2",
      );
      return drainStream(p.slug);
    })();
    expect(stream).toContain("precise mode");
  });

  it("keeps the fast narration (no precise-mode wait) on a non-hi-fi Figma turn", async () => {
    // A generation-intent-but-not-hi-fi prompt (build intent via "functional",
    // no precise/exact phrasing) routes to the generator but must NOT pay the
    // wider digest wait — it keeps the fast 15s budget.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    await post(p.slug, "make the input functional https://www.figma.com/design/k/x?node-id=1-2");
    const stream = await drainStream(p.slug);
    expect(stream).toContain("Loading Figma design context…");
    expect(stream).not.toContain("precise mode");
  });
});

describe("eject-to-source on a compose-base turn", () => {
  it("ejects the named composite and tells the agent where it is", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const prompt =
      "Implement this precisely. Modify the ComputerScene composite as a base. " +
      "https://www.figma.com/design/k/x?node-id=1-2";
    const res = await post(p.slug, prompt);
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    // Ejected copy written to the project's .eject staging dir.
    const ejected = path.join(
      process.env.ARCADE_STUDIO_ROOT!, "projects", p.slug, ".eject", "ComputerScene.tsx",
    );
    expect(fs.existsSync(ejected)).toBe(true);

    // Prompt handed to the agent names the ejected path + the local-import rule.
    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf8");
    expect(sent).toContain(".eject/ComputerScene.tsx");
  });

  it("does NOT eject on a plain precise prompt with no named composite", async () => {
    // A pure precise prompt now routes to the deterministic kit-emit branch,
    // which never ejects. (A build-intent prompt naming a composite ejects —
    // see the test above.) Either way, no .eject dir here.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    await post(p.slug, "Implement this precisely https://www.figma.com/design/k/x?node-id=1-2");
    await drainStream(p.slug);
    const ejectDir = path.join(process.env.ARCADE_STUDIO_ROOT!, "projects", p.slug, ".eject");
    expect(fs.existsSync(ejectDir)).toBe(false);
  });
});
