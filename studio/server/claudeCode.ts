import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStreamLineAll, type StudioEvent } from "../src/lib/streamJson";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// Prototyper root: contains studio/prototype-kit — where composites + templates live.
const PROTOTYPER_ROOT = path.resolve(MODULE_DIR, "..", "..");
// PreToolUse hook that blocks `sips`/ImageMagick/PIL commands — the agent has
// a recurring failure mode where it crops/rescales pasted screenshots into
// sub-images and reads them back, burning the turn budget without producing
// JSX. Structural enforcement instead of a prompt rule, because prompt rules
// for this pattern have failed before.
const BLOCK_IMAGE_RESHAPE_HOOK = path.resolve(MODULE_DIR, "hooks", "blockImageReshape.mjs");
// PostToolUse hook that blocks Write/Edit tool calls introducing named
// imports (from "arcade/components" / "arcade-prototypes") that don't
// exist in the real barrels. Emits Did-you-mean suggestions on block so
// the model self-corrects in the same turn.
const VALIDATE_ARCADE_IMPORTS_HOOK = path.resolve(MODULE_DIR, "hooks", "validateArcadeImports.mjs");
// Arcade-gen clone: contains src/components (stories, icons barrel) the agent
// consults for component APIs. Overridable via env for non-default checkouts;
// falls back to ~/arcade-gen when HOME is set, and to an unresolvable sentinel
// otherwise so a misconfigured environment fails loudly rather than silently
// pointing at cwd.
const ARCADE_GEN_ROOT = process.env.ARCADE_GEN_ROOT
  ?? (process.env.HOME ? path.resolve(process.env.HOME, "arcade-gen") : "/__arcade_gen_unconfigured");

export interface RunTurnOptions {
  cwd: string;
  prompt: string;
  sessionId?: string;
  /** Absolute path to the `claude` binary. In tests, a fake. In production, node_modules/.bin/claude. */
  bin: string;
  env?: Record<string, string>;
  /** Optional image paths to attach; will be included in the prompt via @-references. */
  images?: string[];
  onEvent: (e: StudioEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra dirs the agent may read. Defaults to prototyper + arcade-gen so the
   *  agent can consult prototype-kit sources and arcade-gen stories/icon barrel. */
  addDirs?: string[];
  /** Kill the process if no stdout chunks arrive for this many ms. Default
   *  120_000. Set to 0 to disable. A stall ≠ a timeout: stalls happen when
   *  Bedrock accepts our request and then never streams a response. We
   *  auto-retry stalls (via `runClaudeTurnWithRetry`) but not hard timeouts.
   *  Bedrock tail latency after a large tool-result round-trip can exceed
   *  60s before the first token — 120s covers those legitimate long first
   *  tokens without waiting the full hard timeout. */
  stallMs?: number;
  /** Claude model to use (alias like `sonnet`/`opus`/`haiku` or pinned id
   *  like `claude-opus-4-7`). When unset, falls back to the
   *  `ARCADE_STUDIO_MODEL` env var, then the CLI default. The chat
   *  middleware threads the user's saved setting through this option. */
  model?: string;
  /** Optional hook called on failure with the full stderr buffer + exit info.
   *  Used by the chat middleware to persist a crash log next to the project.
   *  `rawStdout` is every byte claude wrote to stdout this turn — useful for
   *  diagnosing stalls where the CLI goes silent mid-turn (Bedrock hang,
   *  throttling, or events we aren't parsing). */
  onCrash?: (info: {
    exitCode: number | null;
    stderr: string;
    rawStdout: string;
    timedOut: boolean;
    stalled: boolean;
  }) => void;
  /** When true, a hard timeout does NOT emit a terminal `end` event —
   *  `onCrash` still fires with `timedOut: true` and the caller decides
   *  whether to retry. Default false (back-compat: timeout emits `end`). */
  deferTimeoutEnd?: boolean;
}

const DEFAULT_ALLOWED_TOOLS = "Read,Edit,Write,Glob,Grep,Bash";
// figma-console MCP requires a live Figma Bridge plugin; in our environment
// it is not running, so it silently returns empty/hallucinated data. Block
// it entirely so the agent falls back to the `figmanage` CLI (REST-backed,
// no desktop dependency).
const DEFAULT_DISALLOWED_TOOLS = "mcp__figma-console";

export async function runClaudeTurn(opts: RunTurnOptions): Promise<void> {
  // `--bare` skips plugin sync, auto-memory, CLAUDE.md auto-discovery, hooks,
  // and keychain reads. That is a direct fix for the Bedrock stalls we were
  // seeing: every plugin the user has installed in their global claude config
  // (`~/.claude/plugins/…`) contributes to the first-turn system prompt and,
  // for MCP-backed plugins, performs a boot-time handshake. With 10 plugins
  // loaded the init event completes but the first Bedrock call then hangs
  // for the full timeout budget.
  //
  // We still get what studio needs because:
  //   - The generator's Figma integration uses the standalone `figmanage` CLI
  //     (no plugin required — runs via Bash).
  //   - The generator's DevRev integration uses REST over HTTPS (no plugin
  //     required — runs via Bash/curl).
  //   - Bedrock auth via `AWS_BEARER_TOKEN_BEDROCK` still works in bare mode.
  //   - Project CLAUDE.md is read via `--add-dir <projectCwd>` below.
  // If we later need a specific plugin during generation we can opt it in
  // with `--plugin-dir` without giving up bare mode.
  const addDirs = opts.addDirs ?? [PROTOTYPER_ROOT, ARCADE_GEN_ROOT];
  // Model override. Resolution order:
  //   1. `opts.model` — per-turn override (chat middleware reads user's
  //      selection from settings.json).
  //   2. `ARCADE_STUDIO_MODEL` env var — shell-level override, useful for
  //      A/B testing from the command line without persisting settings.
  //   3. Unset → `--model` flag is omitted and claude CLI picks its default
  //      (currently the latest Sonnet).
  // Accepts aliases (`sonnet`, `opus`, `haiku`) or pinned IDs (e.g.
  // `claude-opus-4-7`).
  const model = opts.model?.trim() || process.env.ARCADE_STUDIO_MODEL?.trim();
  // Inline settings: --bare turns off hook discovery, but --settings is an
  // explicit opt-in. We register just the hooks studio needs (currently
  // one PreToolUse hook on Bash) without pulling the user's global hooks
  // back in.
  const settings = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          // Quote the hook path — in the packaged app it lives under
          // ".../Arcade Studio.app/..." (spaces), and an unquoted command
          // would split on the space and fail to launch the hook.
          hooks: [{ type: "command", command: `node ${JSON.stringify(BLOCK_IMAGE_RESHAPE_HOOK)}` }],
        },
      ],
      PostToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: `node ${JSON.stringify(VALIDATE_ARCADE_IMPORTS_HOOK)}` }],
        },
      ],
    },
  });
  const args = [
    "-p", decoratePrompt(opts.prompt, opts.images),
    "--output-format", "stream-json",
    "--verbose",
    // `--include-partial-messages` makes the CLI emit `content_block_delta`
    // events with `input_json_delta` chunks so we can stream tool input
    // character-by-character. Required by the v2 live-cursor pipeline.
    "--include-partial-messages",
    "--bare",
    "--settings", settings,
    "--dangerously-skip-permissions",
    "--allowed-tools", DEFAULT_ALLOWED_TOOLS,
    "--disallowed-tools", DEFAULT_DISALLOWED_TOOLS,
    // Bare mode disables CLAUDE.md auto-discovery, so we must add the
    // project cwd explicitly — that's where the rendered CLAUDE.md lives.
    "--add-dir", opts.cwd,
  ];
  if (model) args.push("--model", model);
  for (const dir of addDirs) args.push("--add-dir", dir);
  if (opts.sessionId) args.push("--resume", opts.sessionId);

  return new Promise<void>((resolve, reject) => {
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (k.startsWith("CLAUDE_CODE_") || k.startsWith("CLAUDECODE_")) continue;
      cleanEnv[k] = v;
    }
    const proc = spawn(opts.bin, args, {
      cwd: opts.cwd,
      env: {
        ...cleanEnv,
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_REGION: process.env.AWS_REGION ?? "us-east-1",
        ...opts.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const abortHandler = () => proc.kill("SIGTERM");
    opts.signal?.addEventListener("abort", abortHandler);

    const timeoutMs = opts.timeoutMs ?? 900_000;
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    // Stall detection: Bedrock hangs present as "claude accepted our call,
    // emitted a few tool_result lines, and then goes silent indefinitely
    // until our hard timeout fires". A fresh-stdout watchdog catches this
    // 2-3× faster and lets us auto-retry without the user waiting the full
    // timeout budget.
    const stallMs = opts.stallMs ?? 120_000;
    let lastStdoutAt = Date.now();
    let stalled = false;
    const stallInterval = stallMs > 0
      ? setInterval(() => {
          if (Date.now() - lastStdoutAt > stallMs) {
            stalled = true;
            try { proc.kill("SIGTERM"); } catch {}
          }
        }, Math.min(5_000, Math.max(1_000, Math.floor(stallMs / 4))))
      : null;

    let stdoutBuf = "";
    // Raw transcript: appended with each chunk from claude, preserved untouched
    // so we can post-mortem even when our parser returned [] for every line.
    let rawStdout = "";
    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk: string) => {
      lastStdoutAt = Date.now();
      rawStdout += chunk;
      stdoutBuf += chunk;
      let idx: number;
      while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        for (const ev of parseStreamLineAll(line)) opts.onEvent(ev);
      }
    });

    let stderrBuf = "";
    proc.stderr.on("data", (c) => { stderrBuf += c.toString(); });

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      if (stallInterval) clearInterval(stallInterval);
    };

    proc.on("error", (err) => {
      cleanup();
      opts.onCrash?.({
        exitCode: null,
        stderr: `${err.stack ?? err.message}`,
        rawStdout,
        timedOut: false,
        stalled: false,
      });
      reject(err);
    });
    // `exit` fires when the child process terminates. `close` fires when its
    // stdio streams are also flushed and closed — usually the same instant,
    // but on SIGTERM after a hanging child, `close` occasionally never fires
    // because the pipes remain referenced by dangling file descriptors. That
    // would strand our Promise. If exit fires without a timely close,
    // force-destroy the pipes so `close` fires.
    let exited = false;
    proc.on("exit", () => {
      exited = true;
      setTimeout(() => {
        if (!exited) return;
        try { proc.stdout.destroy(); } catch {}
        try { proc.stderr.destroy(); } catch {}
      }, 50).unref();
    });
    proc.on("close", (code) => {
      exited = false; // close landed, cancel the force-destroy path
      cleanup();
      opts.signal?.removeEventListener("abort", abortHandler);
      if (stdoutBuf.trim()) {
        for (const ev of parseStreamLineAll(stdoutBuf)) opts.onEvent(ev);
      }
      if (stalled) {
        // Stalls are recoverable via retry — do NOT emit a terminal `end`
        // here; let the retry wrapper decide. We still surface the crash
        // info so the log persists.
        opts.onCrash?.({
          exitCode: code,
          stderr: stderrBuf,
          rawStdout,
          timedOut: false,
          stalled: true,
        });
      } else if (timedOut) {
        if (!opts.deferTimeoutEnd) {
          const seconds = Math.round(timeoutMs / 1000);
          opts.onEvent({
            kind: "end",
            ok: false,
            error: `Turn timed out after ${seconds}s — claude stopped responding. See last-error.log and last-stdout.log for raw output.`,
          });
        }
        opts.onCrash?.({
          exitCode: code,
          stderr: stderrBuf,
          rawStdout,
          timedOut: true,
          stalled: false,
        });
      } else if (code !== 0) {
        const errMsg = stderrBuf.trim() || `claude exited ${code}`;
        opts.onEvent({ kind: "end", ok: false, error: errMsg });
        opts.onCrash?.({
          exitCode: code,
          stderr: stderrBuf,
          rawStdout,
          timedOut: false,
          stalled: false,
        });
      }
      resolve();
    });
  });
}

/**
 * Retry wrapper around `runClaudeTurn` that recovers from Bedrock stalls
 * AND hard timeouts by re-spawning claude with `--resume <sessionId>`. A
 * stall is "no stdout for stallMs". A timeout is "turn running longer than
 * timeoutMs" — usually a legitimately-busy long turn (e.g. generating
 * multiple frames) rather than a failure. In both cases the session is
 * preserved, so the resumed claude picks up where it left off.
 *
 * Transparent to the SSE stream except for a single "picking this up…"
 * narration between attempts, and a final aggregated error if all
 * attempts exhausted the retry budget.
 */
export async function runClaudeTurnWithRetry(
  opts: RunTurnOptions,
  cfg: { maxAttempts?: number; stallMs?: number } = {},
): Promise<void> {
  const maxAttempts = Math.max(1, cfg.maxAttempts ?? 2);
  const stallMs = cfg.stallMs ?? 120_000;
  const userOnCrash = opts.onCrash;
  let capturedSessionId = opts.sessionId;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let didStall = false;
    let didTimeout = false;
    await runClaudeTurn({
      ...opts,
      sessionId: capturedSessionId,
      stallMs,
      deferTimeoutEnd: true,
      onEvent: (ev) => {
        if (ev.kind === "session") capturedSessionId = ev.sessionId;
        opts.onEvent(ev);
      },
      onCrash: (info) => {
        if (info.stalled) didStall = true;
        if (info.timedOut) didTimeout = true;
        // Only forward crash logs on the final attempt, or when the failure
        // is not retryable (non-zero exit, not a stall, not a timeout).
        const retryable = info.stalled || info.timedOut;
        if (!retryable || attempt === maxAttempts) {
          userOnCrash?.(info);
        }
      },
    });
    if (!didStall && !didTimeout) return;
    if (attempt < maxAttempts) {
      opts.onEvent({
        kind: "narration",
        text: "Still working — picking this up where it left off…",
      });
    } else {
      // All attempts exhausted. Emit a user-facing terminal message that
      // doesn't reference log files — beta users can't act on those.
      // Distinguish stall-only failures from timeout exhaustion so the
      // copy matches the actual failure mode.
      const error = didStall && !didTimeout
        ? "Claude kept stalling during this turn. Try sending your prompt again — Bedrock may be throttling."
        : "This turn ran long enough to hit the retry budget without finishing. Type 'keep going' to continue from where it left off.";
      opts.onEvent({ kind: "end", ok: false, error });
    }
  }
}

function decoratePrompt(prompt: string, images?: string[]): string {
  if (!images?.length) return prompt;
  const refs = images.map((p) => `@${p}`).join("\n");
  return `${prompt}\n\nReference images:\n${refs}`;
}
