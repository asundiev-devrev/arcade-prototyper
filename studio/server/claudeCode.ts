import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStreamLineAll, type StudioEvent } from "../src/lib/streamJson";
import { globalMemoryDir } from "./paths";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// Prototyper root: contains studio/prototype-kit — where composites + templates live.
const PROTOTYPER_ROOT = path.resolve(MODULE_DIR, "..", "..");
// The kit manifest (~15K tokens) is the agent's component API reference. It is
// large, STABLE, and behaviorally inert (pure reference, not rules). We inject
// it via `--append-system-prompt` rather than as a CLAUDE.md `@import` for one
// reason: PROMPT CACHE POSITION. Anything in the CLAUDE.md file lands AFTER the
// CLI's last cache breakpoint, so it re-creates (cache miss) on EVERY Bedrock
// round-trip — ~15K tokens × ~7 round-trips/turn of pure waste. Content passed
// via --append-system-prompt lands INSIDE the cached system-prompt region:
// measured cache_read jumps from 30.7K → 54.2K and the manifest stops
// re-creating after the first call. This is the warm-cache win, no SDK needed.
// Behavioral rules stay in CLAUDE.md (the file is the authoritative instruction
// source; system-prompt-injected text is obeyed more loosely, so only the inert
// reference moves here).
const KIT_MANIFEST_PATH = path.resolve(PROTOTYPER_ROOT, "studio", "prototype-kit", "KIT-MANIFEST.md");
let kitManifestCache: string | null = null;
/** Read the kit manifest once per process; cached in memory. Returns "" if it
 *  can't be read (then the agent falls back to reading composite sources — the
 *  pre-existing behavior, just slower). The kitManifestPlugin keeps the file
 *  fresh on disk at dev time, so a stale in-process cache only matters if a
 *  composite changes mid-session; acceptable for a generation subprocess. */
function loadKitManifest(): string {
  if (kitManifestCache !== null) return kitManifestCache;
  try {
    kitManifestCache = readFileSync(KIT_MANIFEST_PATH, "utf-8");
  } catch {
    kitManifestCache = "";
  }
  return kitManifestCache;
}
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

// Studio's default generation model. Sonnet is the fast/quality sweet spot for
// UI frame generation. A user can override per-project via the Settings
// "Generation model" dropdown (threaded through as opts.model). We pin it here
// rather than inheriting the user's global ~/.claude model, which can silently
// be Opus (much slower) — see the model-resolution comment in runClaudeTurn.
const DEFAULT_GENERATION_MODEL = "sonnet";
const DEFAULT_ALLOWED_TOOLS = "Read,Edit,Write,Glob,Grep,Bash";
// figma-console MCP requires a live Figma Bridge plugin; in our environment
// it is not running, so it silently returns empty/hallucinated data. Block
// it entirely so the agent falls back to the `figmanage` CLI (REST-backed,
// no desktop dependency).
//
// AskUserQuestion is blocked because the generator runs HEADLESS (`-p`): there
// is no interactive client to answer a clarifying question, so the call hangs
// until the agent gives up and free-styles (e.g. asking "React or HTML?" then
// writing a bare .html into the project root instead of a kit frame). Without
// `--bare`, this tool is in the default set, so we must disallow it explicitly.
const DEFAULT_DISALLOWED_TOOLS = "mcp__figma-console,AskUserQuestion";

export async function runClaudeTurn(opts: RunTurnOptions): Promise<void> {
  // Plugin/MCP isolation WITHOUT `--bare`. We used to pass `--bare`, but in
  // claude CLI 2.1.x `--bare`'s minimal mode ALSO strips the `Write` tool —
  // the agent is left with only Read/Edit/Bash and reports "Write is not
  // enabled in this context". Every "create a new frame" turn then degrades:
  // the agent reaches for Write, is refused, and falls back to slow `cat >`
  // Bash heredocs that fail on missing dirs and trigger minutes of thrash.
  // That single regression was the dominant cause of 4-minute turns on
  // trivial prompts.
  //
  // The reason `--bare` was here in the first place is the Bedrock stall: the
  // user's globally-installed plugins (`~/.claude/plugins/…`) each contribute
  // to the first-turn system prompt and, for MCP-backed plugins, perform a
  // boot-time handshake; with many loaded, the first Bedrock call hangs the
  // whole timeout budget. We reproduce the ONE thing about `--bare` that
  // mattered — not loading ambient MCP servers — with two surgical flags that
  // do NOT touch the tool set or CLAUDE.md loading:
  //   - `--strict-mcp-config` — ignore ALL ambient MCP servers (we pass none
  //     via --mcp-config), which kills the boot handshake that caused stalls.
  //   - `--exclude-dynamic-system-prompt-sections` — moves per-machine prompt
  //     sections into the first user message; a free cross-user prompt-cache
  //     reuse win, no behavior change for us.
  // Deliberately NOT used:
  //   - `--bare` — its 2.1.x minimal mode strips the Write tool (see above).
  //   - `--setting-sources ""` — it ALSO disables cwd CLAUDE.md loading, so
  //     the agent loses the whole generator system prompt and free-styles a
  //     bare .html into the project root. Verified: with it, CLAUDE.md is NOT
  //     in context; without it, CLAUDE.md loads and Write works.
  // Studio's OWN hooks load because we pass them explicitly via
  // `--settings <json>` below (verified: they fire under these flags).
  //
  // We still get what studio needs because:
  //   - Figma uses the standalone `figmanage` CLI (Bash, no plugin).
  //   - DevRev uses REST over HTTPS (Bash/curl, no plugin).
  //   - Bedrock auth via `AWS_BEARER_TOKEN_BEDROCK` is unaffected.
  //   - Project CLAUDE.md is read via `--add-dir <projectCwd>` below.
  const addDirs = opts.addDirs ?? [PROTOTYPER_ROOT, ARCADE_GEN_ROOT, globalMemoryDir()];
  // Model resolution. Order:
  //   1. `opts.model` — the user's explicit pick in Studio Settings (the
  //      "Generation model" dropdown: sonnet / opus / haiku). Wins always, so
  //      switching to Opus for a hard frame is one click.
  //   2. `ARCADE_STUDIO_MODEL` env — shell-level A/B override.
  //   3. DEFAULT_GENERATION_MODEL (sonnet) — Studio's own default.
  //
  // Why a hard default instead of "let the CLI pick": dropping `--bare` (it was
  // stripping the Write tool) means the subprocess now inherits the user's
  // GLOBAL ~/.claude config — including a pinned `model`. Telemetry caught a
  // tester silently running Opus (slowest tier) because their global config
  // pins it, with no Studio-side choice involved. Pinning sonnet here makes the
  // generator's speed predictable across every machine; the Settings dropdown
  // remains the escape hatch for anyone who wants Opus.
  // Accepts aliases (`sonnet`, `opus`, `haiku`) or pinned IDs.
  const model =
    opts.model?.trim() || process.env.ARCADE_STUDIO_MODEL?.trim() || DEFAULT_GENERATION_MODEL;
  // Inline settings: `--settings <json>` registers exactly the hooks studio
  // needs (image-reshape block on Bash, import validation on Write/Edit). We
  // do not pass `--setting-sources ""` (it would disable CLAUDE.md loading),
  // but the user's own hooks still don't fire during a turn because their
  // global config isn't a project/local source for this spawned cwd.
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
    // MCP isolation that — unlike `--bare` — keeps the Write tool AND keeps
    // CLAUDE.md loading. See the comment block at the top of this function.
    "--strict-mcp-config",
    "--exclude-dynamic-system-prompt-sections",
    "--settings", settings,
    "--dangerously-skip-permissions",
    "--allowed-tools", DEFAULT_ALLOWED_TOOLS,
    "--disallowed-tools", DEFAULT_DISALLOWED_TOOLS,
    // CLAUDE.md auto-loads from the spawn cwd, but add it explicitly too so
    // the agent has read access to the whole project dir.
    "--add-dir", opts.cwd,
  ];
  // Inject the kit manifest into the CACHED system-prompt region (see the
  // KIT_MANIFEST_PATH comment at the top of this file). This is the single
  // biggest per-turn latency lever: the ~15K-token manifest stops re-creating
  // on every Bedrock round-trip and is served from cache instead. Skipped only
  // if the file is unreadable (agent falls back to reading composite sources).
  const manifest = loadKitManifest();
  if (manifest) {
    args.push("--append-system-prompt", manifest);
  }
  if (model) args.push("--model", model);
  for (const dir of addDirs) args.push("--add-dir", dir);
  // Only pass --resume when the id is a well-formed session UUID. A malformed
  // id (corrupted project.json, a placeholder like
  // "ghost-ef-0000-0000-0000-000000000000", a stale non-UUID) makes the CLI
  // exit non-zero with "--resume requires a valid session ID" BEFORE the
  // agent runs — a wasted spawn the user sees as a blank crash. Dropping it
  // up front starts a fresh session instead, which is exactly what the
  // downstream stale-session recovery would do anyway, minus the dead spawn.
  if (opts.sessionId) {
    if (isValidSessionId(opts.sessionId)) {
      args.push("--resume", opts.sessionId);
    } else {
      console.warn(
        `[studio] ignoring malformed sessionId ${JSON.stringify(opts.sessionId)} — starting a fresh session`,
      );
    }
  }

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
    //
    // Two thresholds. The SOFT threshold (half of stallMs, ~60s) does NOT
    // kill — it emits one narration so the user sees "model went quiet,
    // hanging on" instead of a silent frozen pane. This is the single
    // highest-leverage churn fix: a stall used to be 0-240s of dead air
    // ending in an error; now it's visibly-progressing dead air. The HARD
    // threshold (stallMs) kills + lets the retry wrapper re-spawn.
    const stallMs = opts.stallMs ?? 120_000;
    const softStallMs = stallMs > 0 ? Math.floor(stallMs / 2) : 0;
    let lastStdoutAt = Date.now();
    let stalled = false;
    let softStallWarned = false;
    const stallInterval = stallMs > 0
      ? setInterval(() => {
          const silentFor = Date.now() - lastStdoutAt;
          if (silentFor > stallMs) {
            stalled = true;
            console.warn(
              `[studio] claude stalled: no stdout for ${Math.round(silentFor / 1000)}s (limit ${Math.round(stallMs / 1000)}s) — killing for retry`,
            );
            try { proc.kill("SIGTERM"); } catch {}
          } else if (!softStallWarned && softStallMs > 0 && silentFor > softStallMs) {
            // First time we cross the soft threshold this silence window.
            // Reset by any fresh stdout chunk (see the stdout handler).
            softStallWarned = true;
            opts.onEvent({
              kind: "narration",
              text: "The model has gone quiet — hanging on, this can take a moment on a busy connection…",
            });
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
      // Fresh output ends the current silence window — re-arm the soft-stall
      // warning so a later stall in the same turn warns again.
      softStallWarned = false;
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
  // One-shot guard: a stale `--resume <id>` (the session file was pruned,
  // the machine moved, or CLAUDE.md refresh cleared it mid-flight) makes
  // claude exit non-zero with "No conversation found with session ID: …".
  // That kills the turn before the agent runs — the user sees nothing. We
  // recover ONCE by dropping the dead id and re-spawning fresh. This is
  // OUTSIDE the stall/timeout attempt budget so it can't compound, and it's
  // one-shot so a fresh session that *also* reports the error (pathological)
  // surfaces normally instead of looping.
  let recoveredStaleSession = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let didStall = false;
    let didTimeout = false;
    let staleSession = false;
    await runClaudeTurn({
      ...opts,
      sessionId: capturedSessionId,
      stallMs,
      deferTimeoutEnd: true,
      // Suppress the failing terminal `end` when we're going to recover from a
      // stale session — the recovery attempt owns the real terminal event.
      onEvent: (ev) => {
        if (ev.kind === "session") capturedSessionId = ev.sessionId;
        if (
          ev.kind === "end" &&
          !ev.ok &&
          !recoveredStaleSession &&
          capturedSessionId &&
          isNoConversationError(ev.error)
        ) {
          staleSession = true;
          return; // swallow; recovery attempt below emits the real end
        }
        opts.onEvent(ev);
      },
      onCrash: (info) => {
        if (info.stalled) didStall = true;
        if (info.timedOut) didTimeout = true;
        // Only forward crash logs on the final attempt, or when the failure
        // is not retryable (non-zero exit, not a stall, not a timeout). A
        // recoverable stale-session crash is suppressed the same way.
        const retryable = info.stalled || info.timedOut;
        if ((retryable || staleSession) && attempt !== maxAttempts) return;
        if (staleSession && !recoveredStaleSession) return;
        userOnCrash?.(info);
      },
    });
    if (staleSession && !recoveredStaleSession) {
      // Drop the dead session id and retry fresh, without consuming a
      // stall/timeout attempt.
      recoveredStaleSession = true;
      capturedSessionId = undefined;
      opts.onEvent({
        kind: "narration",
        text: "Couldn't resume the previous session — starting a fresh one and picking this up…",
      });
      attempt -= 1; // this iteration didn't count toward the budget
      continue;
    }
    if (!didStall && !didTimeout) return;
    if (attempt < maxAttempts) {
      // Name the reason so the user reads it as recovery, not a fresh hang.
      opts.onEvent({
        kind: "narration",
        text: didStall
          ? `The connection stalled — retrying (attempt ${attempt + 1} of ${maxAttempts}) and picking up where it left off…`
          : "Still working — picking this up where it left off…",
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

/**
 * True when an error string means the stored `--resume <id>` is unusable, so
 * the turn died before the agent ran. Two known phrasings, both surfaced to
 * us as an `end` error (claude exits non-zero):
 *   - "No conversation found with session ID: …" — a valid-format id whose
 *     session file was pruned / never synced / the machine moved.
 *   - "--resume requires a valid session ID or session title …" — a
 *     malformed id (e.g. corrupted project.json).
 * Either way the recovery is identical: drop the dead id, start fresh.
 * Matched loosely because the CLI's exact phrasing drifts across versions.
 */
/**
 * True when `id` is a well-formed Claude session id. Claude CLI session ids
 * are UUIDs (8-4-4-4-12 hex). We accept any RFC-4122-shaped UUID rather than
 * pinning the version nibble, since the CLI's exact format could drift; what
 * we're guarding against is junk like "ghost-ef-0000-0000-0000-000000000000"
 * (non-hex first group) or a truncated id that would make `--resume` fail
 * before the agent runs. A whole-string match is required.
 */
export function isValidSessionId(id: string | undefined): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
}

export function isNoConversationError(error: string | undefined): boolean {
  if (!error) return false;
  return (
    /no conversation found/i.test(error) ||
    /--resume requires a valid session/i.test(error)
  );
}

function decoratePrompt(prompt: string, images?: string[]): string {
  if (!images?.length) return prompt;
  const refs = images.map((p) => `@${p}`).join("\n");
  return `${prompt}\n\nReference images:\n${refs}`;
}
