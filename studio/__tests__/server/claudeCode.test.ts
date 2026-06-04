// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runClaudeTurn, runClaudeTurnWithRetry } from "../../server/claudeCode";

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

  it("passes --resume when sessionId is provided", async () => {
    const spy = path.join(__dirname, "../fixtures/fake-claude-spy.sh");
    const logFile = path.join(os.tmpdir(), `claude-args-${Date.now()}.log`);
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    fs.writeFileSync(logFile, "");
    try {
      await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, sessionId: "abc", onEvent: () => {} });
      const args = fs.readFileSync(logFile, "utf-8");
      expect(args).toMatch(/--resume abc/);
      expect(args).toMatch(/--verbose/);
      expect(args).toMatch(/--dangerously-skip-permissions/);
      expect(args).toMatch(/--settings/);
      expect(args).toMatch(/blockImageReshape\.mjs/);
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
        sessionId: "ghost-session-id",
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
        { cwd: os.tmpdir(), prompt: "hi", bin: spy, sessionId: "bad id", onEvent: (e) => events.push(e) },
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
