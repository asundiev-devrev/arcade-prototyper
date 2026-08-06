// @vitest-environment node
//
// Regression: what a real turn actually WRITES to the memory store.
//
// chat-memory-capture.test.ts asserts the wiring exists as source text, which
// cannot see semantics: the rollout flag could be inverted, removed, or awaited
// and every one of those assertions still passes. This file runs a real turn
// against a fake claude and reads the store off disk, so the flag, the per-turn
// cap, the fenced-code exemption and the journey seam are all observed as
// behaviour.
//
// Four properties, each of which shipped broken at some point:
//   1. Default (flag unset) writes NOTHING — the only safety property the
//      silent writer has.
//   2. `on` writes the expected rows at the expected levels.
//   3. An illustrative sentinel inside a fenced code block is not a proposal.
//   4. A sentinel that also carries the journey marker neither leaks to the pane
//      nor gets lost.
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chatMiddleware } from "../../../server/middleware/chat";
import { createProject } from "../../../server/projects";
import { __resetTurnRegistryForTests } from "../../../server/turnRegistry";
import { MEMORY_SENTINEL, MAX_MEMORIES_PER_TURN } from "../../../server/memoryContract";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = (name: string) => path.join(__dirname, "../../fixtures", name);
const FAKE_LINE = FIX("fake-claude-memory-line.sh");
const FAKE_EXPLAINS = FIX("fake-claude-memory-explains.sh");
const FAKE_FLOOD = FIX("fake-claude-memory-flood.sh");
const FAKE_JOURNEY = FIX("fake-claude-memory-journey.sh");

let tmp: string;
let server: http.Server;
let port: number;
let savedFlag: string | undefined;

beforeAll(() => {
  for (const f of [FAKE_LINE, FAKE_EXPLAINS, FAKE_FLOOD, FAKE_JOURNEY]) fs.chmodSync(f, 0o755);
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-mem-writes-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  process.env.ARCADE_STUDIO_SKIP_SSO_CHECK = "1";
  savedFlag = process.env.ARCADE_MEMORY_CAPTURE;
  delete process.env.ARCADE_MEMORY_CAPTURE;
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
  if (savedFlag === undefined) delete process.env.ARCADE_MEMORY_CAPTURE;
  else process.env.ARCADE_MEMORY_CAPTURE = savedFlag;
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

interface Row {
  fact: string;
  level: string;
  hits: number;
}

/** The capture write is fire-and-forget, so the file lands just after the stream ends. */
async function readRowsWhenSettled(file: string, expectRows: boolean): Promise<Row[]> {
  for (let i = 0; i < 60; i += 1) {
    if (fs.existsSync(file)) {
      const rows = JSON.parse(fs.readFileSync(file, "utf-8")) as Row[];
      if (rows.length > 0 || !expectRows) return rows;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as Row[]) : [];
}

const projectStore = (slug: string) =>
  path.join(tmp, "projects", slug, "memory", "learned.json");
const globalStore = () => path.join(tmp, "memory", "learned.json");

describe("ARCADE_MEMORY_CAPTURE gates the write, in both directions", () => {
  it("writes NOTHING when the flag is unset (dry is the default)", async () => {
    // The whole rollout rests on this: a silent writer must not write until it
    // is switched on. Asserting only the string "ARCADE_MEMORY_CAPTURE" appears
    // in chat.ts cannot see an inverted or deleted gate.
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_LINE;
    const p = await createProject({ name: "Mem Dry", theme: "arcade", mode: "light" });

    await runTurn(p.slug);
    // Give the fire-and-forget capture the same window the `on` case gets.
    await new Promise((r) => setTimeout(r, 400));

    expect(fs.existsSync(projectStore(p.slug))).toBe(false);
    expect(fs.existsSync(globalStore())).toBe(false);
  });

  it("writes the proposed rows when the flag is `on`", async () => {
    process.env.ARCADE_MEMORY_CAPTURE = "on";
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_LINE;
    const p = await createProject({ name: "Mem On", theme: "arcade", mode: "light" });

    await runTurn(p.slug);

    const projectRows = await readRowsWhenSettled(projectStore(p.slug), true);
    const globalRows = await readRowsWhenSettled(globalStore(), true);

    expect(projectRows.map((r) => r.fact)).toEqual(["Filter chips go in the toolbar"]);
    expect(projectRows[0].level).toBe("project");
    expect(globalRows.map((r) => r.fact)).toEqual(["Active nav rows use neutral gray"]);
    expect(globalRows[0].level).toBe("global");

    // The fixture's third message echoes the template placeholder. It is
    // plumbing, not a memory — nothing anywhere should carry it.
    for (const r of [...projectRows, ...globalRows]) {
      expect(r.fact).not.toContain("the preference, one short sentence");
    }
  });

  it("does not write anything for an explanatory sentinel inside a code fence", async () => {
    // The designer asked how memory works; the reply SHOWS the line and says it
    // recorded nothing. Believing that block would write a permanent
    // every-future-project instruction with no cue.
    process.env.ARCADE_MEMORY_CAPTURE = "on";
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_EXPLAINS;
    const p = await createProject({ name: "Mem Explains", theme: "arcade", mode: "light" });

    const stream = await runTurn(p.slug);
    await new Promise((r) => setTimeout(r, 400));

    expect(fs.existsSync(globalStore())).toBe(false);
    expect(fs.existsSync(projectStore(p.slug))).toBe(false);

    // And the explanation the designer asked for survives intact — gutting the
    // block would silently delete the answer to the question.
    expect(stream).toContain("use sentence case for all headings");
    expect(stream).toContain("I have not recorded anything this turn.");
  });

  it("caps a whole turn at MAX_MEMORIES_PER_TURN across every narration message", async () => {
    // Three messages of 4/4/3 sentinels. The per-message cap alone yields 9 rows
    // from ONE turn; at 200 rows per level that is ~22 turns to fill the cap and
    // start evicting memories the designer actually meant.
    process.env.ARCADE_MEMORY_CAPTURE = "on";
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_FLOOD;
    const p = await createProject({ name: "Mem Flood", theme: "arcade", mode: "light" });

    await runTurn(p.slug);
    const rows = await readRowsWhenSettled(projectStore(p.slug), true);

    expect(rows.length).toBe(MAX_MEMORIES_PER_TURN);
    expect(rows.map((r) => r.fact)).toEqual(["fact a one", "fact a two", "fact a three"]);
  });
});

describe("capture never breaks the turn", () => {
  it("ends the turn cleanly when the memory store cannot be written", async () => {
    // Fire-and-forget means a failed remember is invisible to the designer. The
    // static `void recordProposedMemories(` assertion cannot prove that; an
    // unwritable store can.
    process.env.ARCADE_MEMORY_CAPTURE = "on";
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_LINE;
    const p = await createProject({ name: "Mem Fail", theme: "arcade", mode: "light" });

    const globalDir = path.join(tmp, "memory");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.chmodSync(globalDir, 0o444);
    try {
      const stream = await runTurn(p.slug);
      expect(stream).toContain('"kind":"end","ok":true');
      expect(stream).toContain("Built the settings page.");
      expect(stream).not.toContain("⟐");
    } finally {
      fs.chmodSync(globalDir, 0o755);
    }
  });
});

describe("a sentinel on a journey line", () => {
  it("never reaches the chat pane, and is still recorded", async () => {
    // `→ ` lines become `journey` events, which skip the memory seam and render
    // verbatim. Both halves matter: no leak, and no lost memory.
    process.env.ARCADE_MEMORY_CAPTURE = "on";
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_JOURNEY;
    const p = await createProject({ name: "Mem Journey", theme: "arcade", mode: "light" });

    const stream = await runTurn(p.slug);

    expect(stream).not.toContain(MEMORY_SENTINEL);
    expect(stream).not.toContain("⟐");
    expect(stream).not.toContain("journey-smuggled fact");
    expect(stream).not.toContain('"kind":"journey"');
    // The designer's real reply is untouched.
    expect(stream).toContain("Built the page.");

    const rows = await readRowsWhenSettled(projectStore(p.slug), true);
    expect(rows.map((r) => r.fact)).toEqual(["journey-smuggled fact"]);
  });
});
