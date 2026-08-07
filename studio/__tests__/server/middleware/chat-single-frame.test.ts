// @vitest-environment node
//
// THE SINGLE-FRAME CONSTRAINT, END TO END THROUGH THE REAL HANDLER.
//
// The 2026-08-06 designer session's most-repeated complaint (4 occurrences in the
// 67-prompt corpus) is "you split this into two frames when I told you not to".
// Routing alone cannot fix it: corpus #2 already REACHED the generator, and nothing
// in the prompt told the generator to stay in one frame — while
// templates/CLAUDE.md.tpl actively told it the opposite, listing "pressing Save
// goes to the confirmation" as a cross-frame <FrameLink> signal, which is verbatim
// the shape of #2.
//
// These tests post the VERBATIM corpus prompts to /api/chat with a fake claude bin
// and read the prompt the subprocess actually received. Unit tests on
// buildTurnDirectives (see __tests__/server/figma/turnDirectives.test.ts) prove the
// words are right; only this file proves they ARRIVE.
//
// The Figma digest is mocked to a FORCED MISS throughout, deliberately — that is
// the state the first cut of this feature was silently broken in. See the
// digest-miss describe block for the measurement.
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createProject } from "../../../server/projects";
import { __resetTurnRegistryForTests, getTurn } from "../../../server/turnRegistry";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const corpus = require("../../fixtures/designer-prompts.json") as {
  prompts: Array<{ i: number; isCorrection: boolean; text: string }>;
};
const P = (i: number) => corpus.prompts[i].text;

const kitEmitSpy = vi.hoisted(() =>
  vi.fn(async (input: any) => {
    input.emit({ kind: "narration", text: "Importing the Figma design (stub)…" });
    return { ok: true, frameSlug: "01-figma-stub" };
  }),
);
vi.mock("../../../server/figma/kitEmitBranch", () => ({
  runFigmaKitEmitBranch: kitEmitSpy,
}));

// FORCED DIGEST MISS. getCached → undefined, phase-1 → not-ok. This is the real
// cold-file / over-budget case the surrounding code has a whole comment block
// about (digestRaceBudgetMs, FAST=15s / HIFI=65s), and it makes every test in this
// file exercise the path the constraint used to vanish on.
vi.mock("../../../server/figmaIngest", () => ({
  getFigmaIngest: async () => ({
    getCached: () => undefined,
    getPhase1Pending: () => undefined,
    ingestPhase1: async () => ({ ok: false, reason: "test: forced miss", source: {} }),
    ingest: async () => ({ ok: false, reason: "test: forced miss", source: {} }),
  }),
}));

// Neuter the post-turn DESIGN.md seeder: it spawns a SECOND fake-claude whose argv
// would clobber the shared ARCADE_TEST_PROMPT_OUT capture file this suite asserts
// on. A forced-miss ingest makes it bail before spawning. (Its own behaviour is
// covered by chat-figma-seeder*.test.ts.)
vi.mock("../../../server/figmaSystemIngest", () => ({
  getFigmaSystemIngest: async () => ({
    ingest: async () => ({ ok: false as const, reason: "test: forced miss" }),
    getCached: () => undefined,
    getPending: () => undefined,
  }),
}));

// Import AFTER the mocks so chat.ts binds the stubs.
import { chatMiddleware } from "../../../server/middleware/chat";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAKE = path.join(__dirname, "../../fixtures/fake-claude.sh");

let tmp: string;
let server: http.Server;
let port: number;

beforeAll(() => fs.chmodSync(FAKE, 0o755));

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-single-frame-"));
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
  const maxWaitMs = 3000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const turn = getTurn(slug);
    if (!turn || turn.status !== "running") {
      await new Promise((res) => setTimeout(res, 100));
      break;
    }
    await new Promise((res) => setTimeout(res, 10));
  }
  return text;
}

async function post(slug: string, prompt: string) {
  return fetch(`http://localhost:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, prompt }),
  });
}

/** Post a prompt and return the prompt the claude subprocess actually received. */
async function promptSentFor(prompt: string): Promise<string> {
  const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
  const res = await post(p.slug, prompt);
  expect(res.status).toBe(202);
  await drainStream(p.slug);
  expect(
    fs.existsSync(process.env.ARCADE_TEST_PROMPT_OUT!),
    "claude never ran — the turn took a non-generator branch",
  ).toBe(true);
  return fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf8");
}

describe("the single-frame constraint reaches the agent", () => {
  it("corpus #2 (verbatim) carries the directive, and NOT the whole-frame hi-fi one", async () => {
    // "When I click on Save, I want you to animate the transition to this screen:
    // <url> IMPORTANT: don't separate these screens onto multiple frames, the
    // transition must happen within this single frame."
    //
    // This prompt already reached the generator before this work; what was missing
    // was any instruction to honour the constraint. The hi-fi directive is the
    // thing that must NOT be here: it says "each section has the SAME number of
    // rows, same order, as the PNG", i.e. build a fresh full frame.
    const sent = await promptSentFor(P(2));
    expect(sent).toContain("<single_frame_constraint>");
    expect(sent).toContain("Do NOT create a new frame directory");
    expect(sent).toContain("Do NOT use <FrameLink> on this turn");
    expect(sent).toContain("useState + conditional render");
    expect(sent).not.toContain("<high_fidelity_mode>");
  });

  it("corpus #30's SHOUTING form carries it too", async () => {
    // "…Use this design as reference (DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!):
    // <url>". Before this work #30 routed to the deterministic importer, which runs
    // no model and so could not read one word of it — it stamped a separate frame,
    // and the designer's very next turn (#31) is them explaining the failure back
    // to us. So this asserts BOTH halves: the turn reaches the generator at all,
    // and the constraint arrives with it.
    const sent = await promptSentFor(P(30));
    expect(kitEmitSpy).not.toHaveBeenCalled();
    expect(sent).toContain("<single_frame_constraint>");
    expect(sent).not.toContain("<high_fidelity_mode>");
  });

  it("the directive is the LAST thing in the prompt, after every Figma block", async () => {
    // It opens with "This overrides every other instruction about frames", so it
    // has to be the final word before the model starts.
    const sent = await promptSentFor(P(2));
    const constraintAt = sent.indexOf("<single_frame_constraint>");
    expect(constraintAt).toBeGreaterThan(-1);
    // Nothing else this feature or its neighbours append may follow it.
    for (const later of ["<figma_context", "<edit_reference_designs>", "<high_fidelity_mode>", "<target_frame>"]) {
      const at = sent.indexOf(later);
      if (at > -1) expect(at, later).toBeLessThan(constraintAt);
    }
  });
});

describe("the directive survives a Figma digest MISS", () => {
  // THIS IS THE CASE THE FIRST CUT WAS BROKEN ON, and it is not an edge case: the
  // digest misses whenever the file is cold or figmanage is slow past the race
  // budget, which is exactly when a designer retries. The original attach point was
  // inside the `blocks` array, after `if (!blocks.length) return { prompt, images }`
  // — and on a miss a block is only produced when explicitHiFi is true. Measured
  // detectHiFiIntent: #1 false, #2 false, #30 false, #39 false, i.e. EVERY prompt
  // this design fixes took the swallowing branch. Corpus #30 came back
  // byte-identical, 213 chars in and 213 out.
  //
  // The whole file runs with the ingest mocked to a total miss, so the two tests
  // above are already miss-path tests. These two pin the property explicitly and
  // cover the interaction with explicit hi-fi.
  it("no <figma_context> block resolved, yet the constraint is still there", async () => {
    const sent = await promptSentFor(P(30));
    // Prove the miss really happened — otherwise this test could pass on the hit
    // path and the miss path could stay broken (which is how the defect got through
    // the first review).
    expect(sent).not.toContain("<figma_context");
    expect(sent).toContain("<single_frame_constraint>");
  });

  it("an EXPLICIT hi-fi turn with a constraint keeps hi-fi AND gains the constraint", async () => {
    // The naive suppression widening loses BOTH: the miss branch returns null even
    // on an explicit-hi-fi turn, so the turn would lose the <high_fidelity_mode>
    // block it gets today and never gain the new one — strictly worse than before
    // the fix. The designer asked for precision AND for one frame; they get both,
    // and the frame question is settled by the constraint, which is appended last
    // and overrides everything else about frames.
    const sent = await promptSentFor(
      "Implement this precisely, but keep it in the same frame: " +
        "https://www.figma.com/design/k/x?node-id=1-2",
    );
    expect(sent).toContain("<high_fidelity_mode>");
    expect(sent).toContain("<single_frame_constraint>");
    // Order still holds: the constraint has the last word.
    expect(sent.indexOf("<high_fidelity_mode>")).toBeLessThan(sent.indexOf("<single_frame_constraint>"));
  });
});

describe("a provenance-located edit names its frame", () => {
  it("pasting a node an existing frame already drew targets that frame, not a new one", async () => {
    // Corpus #1's shape — the motivating complaint. Node 5678:118877 is DRAWN
    // INSIDE frame 01-figma-5678-118876 (verified live: `grep -c
    // 'data-figma-id="5678:118877"' index.tsx` → 1). Provenance is a filesystem
    // fact, so this catches a correction without detecting corrections. Written
    // through the REAL Studio frame reader — a stub reader would prove nothing
    // about the adapter.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const frameSlug = "01-figma-5678-118876";
    const fdir = path.join(tmp, "projects", p.slug, "frames", frameSlug);
    fs.mkdirSync(fdir, { recursive: true });
    fs.writeFileSync(
      path.join(fdir, "index.tsx"),
      'export default () => <div data-figma-id="5678:118877" />;\n',
    );
    // The frame must be in the project RECORD — the reader trusts project.json
    // rather than re-enumerating the dir, so the rest of the turn and provenance
    // agree about which frames exist.
    const pj = path.join(tmp, "projects", p.slug, "project.json");
    const rec = JSON.parse(fs.readFileSync(pj, "utf8"));
    rec.frames = [{ slug: frameSlug, name: "Figma 5678 118876", createdAt: "t", size: "1440" }];
    fs.writeFileSync(pj, JSON.stringify(rec));

    const res = await post(p.slug, P(1));
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    // Did NOT stamp a duplicate frame…
    expect(kitEmitSpy).not.toHaveBeenCalled();
    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf8");
    // …and the generator was told which frame this is about, by name.
    expect(sent).toContain("<target_frame>");
    expect(sent).toContain(`\`${frameSlug}\``);
    // Whole-frame hi-fi is suppressed here for the same reason as a single-frame
    // turn: it describes building a fresh full frame.
    expect(sent).not.toContain("<high_fidelity_mode>");
  });
});

describe("no stray directive on turns that state nothing", () => {
  it("an ordinary build turn with a Figma URL is unaffected", async () => {
    const sent = await promptSentFor(
      "Implement this design precisely and make the input functional " +
        "https://www.figma.com/design/k/x?node-id=1-2",
    );
    expect(sent).not.toContain("<single_frame_constraint>");
    expect(sent).not.toContain("<target_frame>");
    // The hi-fi guarantee this turn already had is intact.
    expect(sent).toContain("<high_fidelity_mode>");
  });

  it("a plain non-Figma prompt gets nothing — hard constraint 2", async () => {
    // classifyFigmaTurn/planFigmaTurn return "claude" for EVERY prompt with no
    // Figma URL, so a gate written as `kind === "claude" && …` fires on ordinary
    // prompts too. That mistake already shipped a "Do NOT create a new frame
    // directory" directive at a designer who typed this exact kind of request.
    const sent = await promptSentFor("New screen: an error state with a Try again button");
    expect(sent).not.toContain("<single_frame_constraint>");
    expect(sent).not.toContain("<target_frame>");
  });

  it("even a non-Figma prompt that STATES the constraint gets nothing", async () => {
    // The adversarial version of the guard above: the constraint wording is
    // present, the Figma URL is not. The scope guard must win.
    const sent = await promptSentFor(
      "Add the confirmation step, keep everything on a single frame",
    );
    expect(sent).not.toContain("<single_frame_constraint>");
  });

  it("a bare import still takes the deterministic importer, with no model at all", async () => {
    // The product's speed advantage: 16-26s, no LLM. Nothing in this feature may
    // add a directive here, because there is no model to read one.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    await post(p.slug, P(0));
    await drainStream(p.slug);
    expect(kitEmitSpy).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(process.env.ARCADE_TEST_PROMPT_OUT!)).toBe(false);
  });
});
