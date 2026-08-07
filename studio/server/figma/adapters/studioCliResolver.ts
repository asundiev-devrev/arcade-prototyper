/**
 * Studio's implementation of the layer-4 `TurnResolver` seam.
 *
 * THIS FILE IS THE ADAPTER, NOT THE DESIGN. The seam
 * (server/figma/resolveTurn.ts) is brain: it returns a QUESTION and takes an
 * ANSWER, so a Claude Code / Cursor / Computer host — which is already executing
 * inside a model turn — answers it inline with zero subprocess and zero added
 * latency. Studio is the odd host out: its middleware is not inside a model turn,
 * so it has to go and get one, and that is all this file does.
 *
 * A HEADLESS HOST SHOULD IGNORE THIS FILE ENTIRELY, and that is enforced rather
 * than requested: `__tests__/server/figma/headlessRouting.test.ts` asserts that
 * neither the seam nor the routing layer can reach this module, and a self-test in
 * the same file asserts this module really is "dirty" (it reaches
 * `server/claudeBin.ts` and contains a `node:child_process` import) so the
 * separation assertions cannot quietly become vacuous.
 *
 * THE SHAPE IS COPIED FROM server/figma/systemSynth.ts, deliberately, because that
 * module already runs a non-generator model call in production and its shape encodes
 * two bugs that have already been paid for:
 *
 *  1. THE PROMPT GOES VIA STDIN, NOT ARGV. Passing it positionally after a
 *     multi-value flag makes the CLI's argparser swallow it as a trailing value of
 *     the preceding flag, and it dies with "Input must be provided either through
 *     stdin or as a prompt argument."
 *  2. THE MODEL IS PINNED EXPLICITLY. Auto-memory `studio-generation-model-default`
 *     records the inverse mistake: dropping `--bare` made a call inherit the user's
 *     global `~/.claude` pin, which can be Opus. A classifier is a tiny-output call
 *     and must not silently become the most expensive model on the box.
 *
 * `spawn` is injectable so every test is hermetic — no `claude` binary is launched
 * by the suite, and it passes on a machine with no Bedrock credentials.
 *
 * Unit-tested in __tests__/server/figma/studioCliResolver.test.ts.
 */
import { spawn as spawnChild } from "node:child_process";
import { resolveClaudeBin } from "../../claudeBin";
import type { TurnQuestion } from "../resolveTurn";

export interface CliReply {
  text: string;
  exitCode: number | null;
}

export interface StudioCliResolverDeps {
  /** Injected in tests. Real implementation spawns the `claude` CLI. */
  spawn?: (prompt: string, model: string) => Promise<CliReply>;
  /** Defaults to `sonnet` — see the model note above. */
  model?: string;
  /** SIGTERM budget for the child. The SEAM also enforces its own timeout, because
   *  an inline host has no child to kill; this one stops an orphan process. */
  timeoutMs?: number;
}

/**
 * How much of the designer's prompt the classifier sees.
 *
 * A 376KB prompt piped through subprocess stdin is real latency and memory on a path
 * whose whole budget is ~5-12s, and the classification needs the designer's INTENT,
 * which they state at the start, not their 400th repetition of it. Truncating is
 * strictly better than the alternative of refusing to classify a long prompt.
 */
const MAX_PROMPT_CHARS = 8_000;

/**
 * Bind the seam for Studio.
 *
 * REJECTS ON EVERY FAILURE rather than returning a plausible-looking answer.
 * `resolveTurnOrFallback` turns a rejection into `failed`, and the cascade turns
 * `failed` into the GENERATOR (hard constraint 1) — never into the deterministic
 * importer, which cannot read the prompt at all. So the worst outcome of a broken
 * CLI is a turn that costs more, not a turn that loses the designer's instructions.
 */
export function makeStudioCliResolver(deps: StudioCliResolverDeps = {}) {
  const spawner = deps.spawn ?? defaultSpawner(deps.timeoutMs ?? 25_000);
  const model = deps.model ?? "sonnet";

  return async function studioCliResolver(question: TurnQuestion): Promise<unknown> {
    const reply = await spawner(buildClassifierPrompt(question), model);
    if (!reply || reply.exitCode !== 0) {
      throw new Error(`turn classifier exited ${reply?.exitCode}`);
    }
    // Parse failures THROW, so the seam records `failed`. Returning something
    // half-valid here would be worse than failing: the seam would accept it.
    return JSON.parse(extractJson(reply.text));
  };
}

/**
 * The classifier prompt.
 *
 * Deliberately asks for the SAME three kinds the cascade routes on
 * (`import` / `edit` / `wire`), so no translation table sits between the answer and
 * the branch. The frame list is included because naming a frame provenance could not
 * find is the one capability this layer exists to add — without the list the model
 * can only guess, and a guessed slug is rejected by the seam's allow-list anyway.
 */
function buildClassifierPrompt(q: TurnQuestion): string {
  const prompt = typeof q.prompt === "string" ? q.prompt.slice(0, MAX_PROMPT_CHARS) : "";
  const frames = (q.frameSlugs ?? []).map((s) => `- ${s}`).join("\n") || "- (none yet)";
  const nodes = (q.nodeIds ?? []).join(", ") || "(none)";

  return [
    "You are routing ONE turn in a design-prototyping tool. Output ONE JSON object and nothing else.",
    "No prose, no markdown fences.",
    "",
    "The designer pasted a Figma link and typed a message. Decide what they are asking for:",
    '  "import" — they want this Figma node transcribed faithfully as a new screen.',
    '             Choose this for a plain import or a "copy this exactly" ask.',
    '  "edit"   — they are asking to CHANGE something that already exists, including',
    "             correcting work already produced, or stating a requirement about it.",
    '  "wire"   — they want an interaction between two designs (a click that opens the other).',
    "",
    "Also report:",
    '  "targetFrame"  — the existing screen this turn is about, ONLY if you can name one from',
    "                   the list below. Omit it if you cannot; do not guess.",
    '  "constraints"  — ["single-frame"] ONLY if the designer explicitly said to keep',
    "                   everything in one screen. Otherwise omit or use [].",
    "",
    `Schema: { "kind": "import" | "edit" | "wire", "targetFrame"?: string, "constraints"?: ["single-frame"] }`,
    "",
    `Figma nodes pasted: ${nodes}`,
    "Existing screens in this project:",
    frames,
    "",
    "The designer typed:",
    "```",
    prompt,
    "```",
  ].join("\n");
}

/**
 * Pull the JSON object out of a model reply.
 *
 * Same extraction as systemSynth.ts, for the same reason: a fenced or prose-wrapped
 * reply is the common real-world shape, and re-deriving it per call site is how two
 * callers end up disagreeing about what a valid reply looks like.
 */
function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const stripped = fence ? fence[1] : text;
  const m = stripped.match(/\{[\s\S]*\}/);
  return m ? m[0] : stripped.trim();
}

/**
 * The real CLI call. Never reached in tests — every test injects `spawn`.
 *
 * `--bare` keeps it out of the user's session/project context (this is a
 * classification, not a conversation) AND pins the model, per the note at the top.
 */
function defaultSpawner(timeoutMs: number) {
  return (prompt: string, model: string) =>
    new Promise<CliReply>((resolve) => {
      const bin = resolveClaudeBin();
      const proc = spawnChild(bin, ["--bare", "--model", model, "--print"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let text = "";
      proc.stdout.on("data", (c) => {
        text += c.toString();
      });
      proc.stderr.on("data", () => {});
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGTERM");
        } catch {
          // Already gone.
        }
      }, timeoutMs);
      proc.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ text, exitCode });
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve({ text: "", exitCode: -1 });
      });
      try {
        // STDIN, NOT ARGV — see the note at the top of this file.
        proc.stdin!.write(prompt);
        proc.stdin!.end();
      } catch {
        // Write errors surface via the close handler above.
      }
    });
}
