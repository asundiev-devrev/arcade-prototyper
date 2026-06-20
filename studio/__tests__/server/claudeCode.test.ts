// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runClaudeTurn, runClaudeTurnWithRetry, isThrottleError } from "../../server/claudeCode";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAKE = path.join(__dirname, "../fixtures/fake-claude.sh");

beforeAll(() => { fs.chmodSync(FAKE, 0o755); });

describe("runClaudeTurn", () => {
  it("captures session id and yields narration", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-cc-"));
    const events: any[] = [];
    await runClaudeTurn({
      cwd: tmp,
      prompt: "hi",
      bin: FAKE,
      env: { FAKE_CLAUDE_SCENARIO: "default" },
      onEvent: (e) => events.push(e),
    });
    expect(events.some((e) => e.kind === "session" && e.sessionId === "sess-001")).toBe(true);
    expect(events.some((e) => e.kind === "narration")).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ kind: "end", ok: true });
  });

  it("propagates error end event on failure", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-cc-"));
    const events: any[] = [];
    await runClaudeTurn({
      cwd: tmp, prompt: "hi", bin: FAKE,
      env: { FAKE_CLAUDE_SCENARIO: "auth_error" },
      onEvent: (e) => events.push(e),
    });
    expect(events[events.length - 1]).toMatchObject({ kind: "end", ok: false });
  });

  it("detects Bedrock throttling on stderr and ends fast with an actionable message", async () => {
    // The fake CLI emits a ThrottlingException on stderr then sleeps 30s. With a
    // generous stall budget, the ONLY way this finishes quickly is the stderr
    // throttle watchdog killing it. Asserts both the fast exit and the message.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-cc-"));
    const events: any[] = [];
    let crash: any = null;
    const t0 = Date.now();
    await runClaudeTurn({
      cwd: tmp, prompt: "hi", bin: FAKE,
      env: { FAKE_CLAUDE_SCENARIO: "throttle" },
      stallMs: 0,          // disable stall watchdog so only throttle-detect can end it
      timeoutMs: 20_000,   // generous; throttle detect must fire well before this
      onEvent: (e) => events.push(e),
      onCrash: (info) => { crash = info; },
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(10_000); // killed fast, not waited out
    const end = events[events.length - 1];
    expect(end).toMatchObject({ kind: "end", ok: false });
    expect(end.error).toMatch(/rate-limit/i);
    expect(end.error).toMatch(/wait/i);
    expect(crash?.throttled).toBe(true);
  }, 25_000);

  it("passes --resume when sessionId is a valid UUID", async () => {
    const spy = path.join(__dirname, "../fixtures/fake-claude-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-args-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    const validId = "ba74cafc-e4a7-4ae2-bc4a-1cb81c37b484";
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, sessionId: validId, onEvent: () => {} });
      const args = fs.readFileSync(logFile, "utf-8");
      expect(args).toMatch(new RegExp(`--resume ${validId}`));
      expect(args).toMatch(/--verbose/);
      expect(args).toMatch(/--dangerously-skip-permissions/);
      expect(args).toMatch(/--settings/);
      expect(args).toMatch(/blockImageReshape\.mjs/);
    } finally {
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("launches write-time hooks via the runtime executable, never a bare `node` (DMG has no node on PATH)", async () => {
    // Regression: the packaged DMG ships no standalone `node`. A hardcoded
    // `node <hook>.mjs` command exited 127 ("node: command not found") and
    // the claude CLI treated the PostToolUse hook as a non-blocking failure,
    // silently disabling import validation + image-reshape blocking on every
    // tester machine. The hook command must invoke the current Node-capable
    // runtime (process.execPath) with ELECTRON_RUN_AS_NODE=1 instead.
    const spy = path.join(__dirname, "../fixtures/fake-claude-hooks-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-hooks-${Date.now()}.log`);
    // Print each arg on its own line so the JSON `--settings` value survives
    // intact (echo "$@" would flatten spaces inside the JSON).
    fs.writeFileSync(
      spy,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(logFile, "");
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, onEvent: () => {} });
      const lines = fs.readFileSync(logFile, "utf-8").split("\n");
      const settingsIdx = lines.indexOf("--settings");
      expect(settingsIdx).toBeGreaterThanOrEqual(0);
      const settings = JSON.parse(lines[settingsIdx + 1]);
      const commands: string[] = [
        ...settings.hooks.PreToolUse.flatMap((m: any) => m.hooks.map((h: any) => h.command)),
        ...settings.hooks.PostToolUse.flatMap((m: any) => m.hooks.map((h: any) => h.command)),
      ];
      expect(commands.length).toBe(2);
      for (const cmd of commands) {
        // Never a bare `node` invocation — that's the bug.
        expect(cmd).not.toMatch(/^node\s/);
        // Must route through the current runtime in node mode.
        expect(cmd).toContain("ELECTRON_RUN_AS_NODE=1");
        expect(cmd).toContain(JSON.stringify(process.execPath));
      }
      // Both guardrail scripts are still wired.
      expect(commands.some((c) => c.includes("blockImageReshape.mjs"))).toBe(true);
      expect(commands.some((c) => c.includes("validateArcadeImports.mjs"))).toBe(true);
    } finally {
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("defaults --model to sonnet (does not inherit the user's global Opus pin)", async () => {
    const spy = path.join(__dirname, "../fixtures/fake-claude-model-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-model-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    const prevEnv = process.env.ARCADE_STUDIO_MODEL;
    delete process.env.ARCADE_STUDIO_MODEL;
    try {
      // No opts.model and no env → must fall back to the sonnet default, NOT
      // omit --model (which would let the subprocess inherit a global Opus pin).
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, onEvent: () => {} });
      const args = fs.readFileSync(logFile, "utf-8");
      expect(args).toMatch(/--model sonnet/);
    } finally {
      if (prevEnv !== undefined) process.env.ARCADE_STUDIO_MODEL = prevEnv;
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("honors an explicit model pick (Settings dropdown) over the default", async () => {
    const spy = path.join(__dirname, "../fixtures/fake-claude-model2-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-model2-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, model: "opus", onEvent: () => {} });
      const args = fs.readFileSync(logFile, "utf-8");
      expect(args).toMatch(/--model opus/);
      expect(args).not.toMatch(/--model sonnet/);
    } finally {
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("injects the kit manifest via --append-system-prompt (cached region), not a CLAUDE.md import", async () => {
    // The manifest must ride in the system-prompt region so it's prompt-cached
    // across round-trips instead of re-created every call. We assert the flag
    // is present and carries real manifest content (a known composite name).
    const spy = path.join(__dirname, "../fixtures/fake-claude-manifest-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-manifest-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, onEvent: () => {} });
      const args = fs.readFileSync(logFile, "utf-8");
      expect(args).toMatch(/--append-system-prompt/);
      // The real manifest names ComputerScene/ComputerPage among its entries.
      expect(args).toMatch(/ComputerScene|ComputerPage|AppShell/);
    } finally {
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("isolates plugins WITHOUT --bare, so the Write tool stays enabled", async () => {
    // Regression guard: claude CLI 2.1.x `--bare` strips the Write tool,
    // forcing the agent into slow Bash heredocs. We must use the surgical
    // isolation flags instead and never reintroduce --bare.
    const spy = path.join(__dirname, "../fixtures/fake-claude-flags-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-flags-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, onEvent: () => {} });
      const args = fs.readFileSync(logFile, "utf-8");
      // The two isolation flags that replaced --bare without stripping Write
      // or CLAUDE.md loading.
      expect(args).toMatch(/--strict-mcp-config/);
      expect(args).toMatch(/--exclude-dynamic-system-prompt-sections/);
      // --setting-sources would disable CLAUDE.md loading — must NOT be passed.
      expect(args).not.toMatch(/--setting-sources/);
      // Write must be in the allowlist; --bare must be gone.
      expect(args).toMatch(/--allowed-tools[ =].*Write/);
      expect(args).not.toMatch(/--bare\b/);
      // AskUserQuestion must be disallowed — headless turns can't answer it.
      expect(args).toMatch(/--disallowed-tools[ =].*AskUserQuestion/);
    } finally {
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("drops --resume when sessionId is malformed (avoids a dead spawn)", async () => {
    const spy = path.join(__dirname, "../fixtures/fake-claude-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-args-bad-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    try {
      // The real-world corruption that motivated the guard.
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, sessionId: "ghost-ef-0000-0000-0000-000000000000", onEvent: () => {} });
      const args = fs.readFileSync(logFile, "utf-8");
      expect(args).not.toMatch(/--resume/);
    } finally {
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("passes --include-partial-messages so we get content_block_delta events", async () => {
    // Required by the v2 live-cursor pipeline: the parser needs
    // input_json_delta chunks (only emitted when this flag is set) to
    // stream tool input character-by-character.
    const spy = path.join(__dirname, "../fixtures/fake-claude-partial-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-partial-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, onEvent: () => {} });
      const args = fs.readFileSync(logFile, "utf-8");
      expect(args).toMatch(/--include-partial-messages/);
    } finally {
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("strips CLAUDE_CODE_* and CLAUDECODE_* vars from child env", async () => {
    const spy = path.join(__dirname, "../fixtures/fake-claude-env-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-env-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\nenv | grep -E '^(CLAUDE_CODE_|CLAUDECODE_)' >> ${logFile} || true\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    process.env.CLAUDE_CODE_LEAK = "should-not-pass";
    process.env.CLAUDECODE_PARENT = "also-not";
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, onEvent: () => {} });
      const leaked = fs.readFileSync(logFile, "utf-8");
      expect(leaked).not.toContain("CLAUDE_CODE_LEAK");
      expect(leaked).not.toContain("CLAUDECODE_PARENT");
      expect(leaked).toContain("CLAUDE_CODE_USE_BEDROCK=1");
    } finally {
      delete process.env.CLAUDE_CODE_LEAK;
      delete process.env.CLAUDECODE_PARENT;
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("times out a runaway process", async () => {
    const spy = path.join(__dirname, "../fixtures/fake-claude-hang.sh");
    fs.writeFileSync(spy, `#!/usr/bin/env bash\nsleep 30\n`, { mode: 0o755 });
    const events: any[] = [];
    const start = Date.now();
    try {
      await runClaudeTurn({
        cwd: os.tmpdir(),
        prompt: "hi",
        bin: spy,
        timeoutMs: 100,
        onEvent: (e) => events.push(e),
      });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000);
      expect(events[events.length - 1]).toMatchObject({
        kind: "end",
        ok: false,
        error: expect.stringMatching(/^Turn timed out after \d+s — claude stopped responding/),
      });
    } finally {
      fs.rmSync(spy, { force: true });
    }
  });

  it("closes child stdin so CLIs that read stdin don't hang", async () => {
    const spy = path.join(__dirname, "../fixtures/fake-claude-stdin-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-stdin-${Date.now()}.log`);
    fs.writeFileSync(
      spy,
      `#!/usr/bin/env bash\nif [ -t 0 ]; then echo "TTY" > ${logFile}; elif read -t 0 _ 2>/dev/null; then echo "PIPE_WITH_DATA" > ${logFile}; else echo "CLOSED_OR_EMPTY" > ${logFile}; fi\nprintf '{"type":"result","subtype":"success"}\\n'\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(logFile, "");
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, onEvent: () => {} });
      const state = fs.readFileSync(logFile, "utf-8").trim();
      expect(state).toBe("CLOSED_OR_EMPTY");
    } finally {
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });

  it("passes --add-dir for the global memory dir", async () => {
    const spy = path.join(__dirname, "../fixtures/fake-claude-mem-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-mem-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    process.env.ARCADE_STUDIO_ROOT = "/tmp/studio-mem-test";
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, onEvent: () => {} });
      const args = fs.readFileSync(logFile, "utf-8");
      expect(args).toContain("--add-dir /tmp/studio-mem-test/memory");
    } finally {
      delete process.env.ARCADE_STUDIO_ROOT;
      fs.rmSync(spy, { force: true });
      fs.rmSync(logFile, { force: true });
    }
  });
});

describe("runClaudeTurnWithRetry", () => {
  it("retries after a hard timeout and emits an 'in progress' narration", { timeout: 10_000 }, async () => {
    // Hanging fake always times out; wrapper should retry up to maxAttempts
    // and emit the soft retry narration between attempts.
    const spy = path.join(__dirname, "../fixtures/fake-claude-retry-hang.sh");
    fs.writeFileSync(spy, `#!/usr/bin/env bash\nsleep 30\n`, { mode: 0o755 });
    const events: any[] = [];
    try {
      await runClaudeTurnWithRetry(
        {
          cwd: os.tmpdir(),
          prompt: "hi",
          bin: spy,
          timeoutMs: 100,
          onEvent: (e) => events.push(e),
        },
        { maxAttempts: 2 },
      );
      const narration = events.find(
        (e) => e.kind === "narration" && /picking this up/i.test(e.text),
      );
      expect(narration).toBeTruthy();
      // Terminal end after both attempts — friendly copy, no log-file jargon.
      const end = events[events.length - 1];
      expect(end.kind).toBe("end");
      expect(end.ok).toBe(false);
      expect(end.error).not.toMatch(/last-error\.log|last-stdout\.log/);
      expect(end.error).toMatch(/keep going/i);
    } finally {
      fs.rmSync(spy, { force: true });
    }
  });

  it("recovers from a stale --resume session by retrying fresh", { timeout: 10_000 }, async () => {
    // The fixture fails like the real CLI on a dangling --resume id (exit 1,
    // "No conversation found..." on stderr) and succeeds when called fresh.
    const spy = path.join(__dirname, "../fixtures/fake-claude-session-recovery.sh");
    fs.chmodSync(spy, 0o755);
    const events: any[] = [];
    await runClaudeTurnWithRetry(
      {
        cwd: os.tmpdir(),
        prompt: "hi",
        bin: spy,
        // A well-formed UUID whose session file was pruned — the real recovery
        // case. (A malformed id is dropped before spawn, never reaching here.)
        sessionId: "00000000-0000-4000-8000-000000000abc",
        onEvent: (e) => events.push(e),
      },
      { maxAttempts: 2 },
    );
    // The failing "No conversation found" end must be suppressed, not forwarded.
    const ends = events.filter((e) => e.kind === "end");
    expect(ends).toHaveLength(1);
    expect(ends[0].ok).toBe(true);
    // A fresh session id was captured on the recovery attempt.
    expect(events.some((e) => e.kind === "session" && e.sessionId === "fresh-sess-002")).toBe(true);
    // Recovery is announced to the user.
    expect(events.some((e) => e.kind === "narration" && /fresh|resume/i.test(e.text))).toBe(true);
  });

  it("recovers from a malformed --resume id (different CLI phrasing)", { timeout: 10_000 }, async () => {
    // Second known phrasing: a malformed id makes the CLI reject --resume with
    // "requires a valid session ID" instead of "No conversation found". Same
    // recovery path. Fixture mimics: fail on --resume, succeed fresh.
    const spy = path.join(__dirname, "../fixtures/fake-claude-badresume.sh");
    fs.writeFileSync(
      spy,
      `#!/usr/bin/env bash\nresume=""\nprev=""\nfor a in "$@"; do\n  if [ "$prev" = "--resume" ]; then resume="$a"; fi\n  prev="$a"\ndone\nif [ -n "$resume" ]; then\n  printf 'Error: --resume requires a valid session ID or session title when used with --print.\\n' >&2\n  exit 1\nfi\nprintf '{"type":"system","subtype":"init","session_id":"fresh-sess-003"}\\n'\nprintf '{"type":"result","subtype":"success"}\\n'\n`,
      { mode: 0o755 },
    );
    const events: any[] = [];
    try {
      await runClaudeTurnWithRetry(
        { cwd: os.tmpdir(), prompt: "hi", bin: spy, sessionId: "11111111-2222-4333-8444-555555555555", onEvent: (e) => events.push(e) },
        { maxAttempts: 2 },
      );
      const ends = events.filter((e) => e.kind === "end");
      expect(ends).toHaveLength(1);
      expect(ends[0].ok).toBe(true);
      expect(events.some((e) => e.kind === "session" && e.sessionId === "fresh-sess-003")).toBe(true);
    } finally {
      fs.rmSync(spy, { force: true });
    }
  });

  it("does not loop forever if a fresh session also reports no conversation", { timeout: 10_000 }, async () => {
    // Pathological: every invocation reports the stale-session error, even
    // without --resume. Recovery must fire at most once, then surface the error.
    const spy = path.join(__dirname, "../fixtures/fake-claude-always-noconv.sh");
    fs.writeFileSync(
      spy,
      `#!/usr/bin/env bash\nprintf 'No conversation found with session ID: whatever\\n' >&2\nexit 1\n`,
      { mode: 0o755 },
    );
    const events: any[] = [];
    try {
      await runClaudeTurnWithRetry(
        { cwd: os.tmpdir(), prompt: "hi", bin: spy, sessionId: "ghost", onEvent: (e) => events.push(e) },
        { maxAttempts: 2 },
      );
      const ends = events.filter((e) => e.kind === "end");
      expect(ends.length).toBeGreaterThanOrEqual(1);
      expect(ends[ends.length - 1].ok).toBe(false);
    } finally {
      fs.rmSync(spy, { force: true });
    }
  });

  it("does not emit the per-turn timeout end when deferred", async () => {
    // When deferTimeoutEnd is true (the mode the retry wrapper uses),
    // the per-turn runner must NOT emit an `end` event on timeout — the
    // caller owns the terminal event so it can decide to retry.
    const spy = path.join(__dirname, "../fixtures/fake-claude-defer-hang.sh");
    fs.writeFileSync(spy, `#!/usr/bin/env bash\nsleep 30\n`, { mode: 0o755 });
    const events: any[] = [];
    try {
      await runClaudeTurn({
        cwd: os.tmpdir(),
        prompt: "hi",
        bin: spy,
        timeoutMs: 100,
        deferTimeoutEnd: true,
        onEvent: (e) => events.push(e),
      });
      expect(events.some((e) => e.kind === "end")).toBe(false);
    } finally {
      fs.rmSync(spy, { force: true });
    }
  });
});

describe("isThrottleError", () => {
  it("matches Bedrock throttle / 429 signatures (any casing/phrasing)", () => {
    expect(isThrottleError("ThrottlingException: Rate exceeded")).toBe(true);
    expect(isThrottleError("ERROR: Too many requests (HTTP 429)")).toBe(true);
    expect(isThrottleError("TooManyRequestsException")).toBe(true);
    expect(isThrottleError("503 ServiceUnavailable: slow down")).toBe(true);
    expect(isThrottleError("bedrock rate limit reached")).toBe(true);
  });
  it("does NOT match unrelated stderr or empty input", () => {
    expect(isThrottleError("")).toBe(false);
    expect(isThrottleError(null)).toBe(false);
    expect(isThrottleError(undefined)).toBe(false);
    expect(isThrottleError("aws sso session expired, run aws sso login")).toBe(false);
    expect(isThrottleError("No conversation found with session ID: abc")).toBe(false);
  });
});
