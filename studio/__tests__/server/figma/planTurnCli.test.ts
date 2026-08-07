import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);

/**
 * The CLI is the ONLY way a non-Studio host reaches the routing brain today, so
 * these tests are the acceptance gate for "the fix is not .dmg-only".
 *
 * They exercise the real binary as a subprocess — no mocking of the boundary the
 * skill actually crosses. That is deliberate: the previous generation of this work
 * shipped a fix that was correct inside Studio and unreachable from a Claude Code
 * session, and unit tests of the pure modules could not have caught it.
 *
 * Cost: each case spawns node + an esbuild bundle (~1-2s). Kept to the cases that
 * would actually regress the contract rather than one per branch.
 */
const CLI = path.resolve(__dirname, "../../../server/figma/cli/planTurn.mjs");
const NODE = process.execPath;

const URL_A = "https://www.figma.com/design/ssU/Onboarding?node-id=5678-118876";
const URL_B = "https://www.figma.com/design/ssU/Onboarding?node-id=5678-118877";

let framesDir: string;

beforeAll(async () => {
  // A frames dir shaped like a real one: a frame whose rendered source carries the
  // data-figma-id of node 5678:118877 — i.e. that node has already been imported.
  framesDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-turn-"));
  const f = path.join(framesDir, "01-figma-5678-118876");
  await fs.mkdir(f, { recursive: true });
  await fs.writeFile(
    path.join(f, "index.tsx"),
    'export default () => <div data-figma-id="5678:118877" />;\n',
    "utf-8",
  );
});

afterAll(async () => {
  await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});
});

/**
 * Each call spawns node AND an esbuild bundle. This repo's esbuild-backed tests are
 * a known flake under full-suite contention (see the target-editor-send note), and
 * a subprocess that loses a CPU race is exactly that shape — it failed once in a
 * full run while passing 3/3 in isolation. So: a generous explicit timeout and one
 * retry, which distinguishes "the machine was busy" from "the CLI is broken"
 * instead of leaving a red suite that everyone learns to ignore.
 */
async function plan(prompt: string, opts: { frames?: string; json?: boolean } = {}) {
  const args = [CLI, "--prompt", prompt];
  if (opts.frames) args.push("--frames", opts.frames);
  if (opts.json) args.push("--json");
  const exec = () => run(NODE, args, { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 });
  try {
    return (await exec()).stdout;
  } catch {
    return (await exec()).stdout; // one retry; a real failure fails twice
  }
}

describe("plan-turn CLI — the headless entry point", () => {
  it("names the frame to EDIT when the pasted node is already rendered", async () => {
    // The live 2026-08-06 failure: this prompt used to stamp a duplicate frame.
    const out = await plan(
      `You haven't implemented this background blur properly: ${URL_B}\n\ntry again`,
      { frames: framesDir },
    );
    expect(out).toContain("EDIT the existing frame");
    expect(out).toContain("01-figma-5678-118876");
    expect(out).toContain("Do NOT create another frame");
  });

  it("keeps a bare faithful import on the deterministic path", async () => {
    const out = await plan(`Implement this precisely: ${URL_A}`, { frames: framesDir });
    expect(out).toContain("import this Figma node faithfully");
    expect(out).not.toContain("EDIT the existing frame");
  });

  it("carries a stated single-frame constraint into verbatim directives", async () => {
    const out = await plan(
      `When I click on "Save", animate the transition to this screen: ${URL_A}\n\n` +
        "IMPORTANT: don't separate these screens onto multiple frames.",
      { frames: framesDir },
    );
    expect(out).toContain("single-frame");
    expect(out).toContain("<single_frame_constraint>");
    expect(out).toContain("Do NOT create a new frame directory");
  });

  it("works with NO frames dir — the bare headless case", async () => {
    // A host that has nothing on disk must still get a usable answer, never an
    // error. Provenance simply has nothing to match, so the turn falls through.
    const out = await plan(`You haven't implemented this properly: ${URL_B} try again`);
    expect(out).toMatch(/ACTION:/);
    expect(out).not.toContain("plan-turn failed");
  });

  it("has no opinion on a prompt with no Figma URL", async () => {
    const out = await plan("make the title red");
    expect(out).toContain("routing has no opinion");
    expect(out).toContain("no-node");
  });

  it("emits a machine-readable plan under --json", async () => {
    const out = await plan(
      `You haven't implemented this blur properly: ${URL_B} try again`,
      { frames: framesDir, json: true },
    );
    const parsed = JSON.parse(out);
    expect(parsed.plan.kind).toBe("claude");
    expect(parsed.plan.targetFrame).toBe("01-figma-5678-118876");
    expect(parsed.plan.decidedBy).toBe("provenance");
    expect(Array.isArray(parsed.directives)).toBe(true);
  });

  it("exits 2 on missing --prompt so a caller can detect misuse", async () => {
    await expect(run(NODE, [CLI])).rejects.toMatchObject({ code: 2 });
  });

  it("tolerates a frames dir that does not exist", async () => {
    const out = await plan(`Implement this precisely: ${URL_A}`, {
      frames: path.join(os.tmpdir(), "definitely-not-here-" + Date.now()),
    });
    expect(out).toMatch(/ACTION:/);
    expect(out).not.toContain("plan-turn failed");
  });
});
