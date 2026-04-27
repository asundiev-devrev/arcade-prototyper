// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runClaudeTurn } from "../../server/claudeCode";

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
        error: expect.stringMatching(/^Turn timed out after \d+ minutes?$/),
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
});
