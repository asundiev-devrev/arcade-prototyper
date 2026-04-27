import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStreamLineAll, type StudioEvent } from "../src/lib/streamJson";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// Prototyper root: contains studio/prototype-kit — where composites + templates live.
const PROTOTYPER_ROOT = path.resolve(MODULE_DIR, "..", "..");
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
}

const DEFAULT_ALLOWED_TOOLS = "Read,Edit,Write,Glob,Grep,Bash";
// figma-console MCP requires a live Figma Bridge plugin; in our environment
// it is not running, so it silently returns empty/hallucinated data. Block
// it entirely so the agent falls back to the `figmanage` CLI (REST-backed,
// no desktop dependency).
const DEFAULT_DISALLOWED_TOOLS = "mcp__figma-console";

export async function runClaudeTurn(opts: RunTurnOptions): Promise<void> {
  const addDirs = opts.addDirs ?? [PROTOTYPER_ROOT, ARCADE_GEN_ROOT];
  const args = [
    "-p", decoratePrompt(opts.prompt, opts.images),
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--allowed-tools", DEFAULT_ALLOWED_TOOLS,
    "--disallowed-tools", DEFAULT_DISALLOWED_TOOLS,
  ];
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

    const timeoutMs = opts.timeoutMs ?? 480_000;
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    let stdoutBuf = "";
    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk: string) => {
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

    proc.on("error", reject);
    proc.on("close", (code) => {
      clearTimeout(timeoutHandle);
      opts.signal?.removeEventListener("abort", abortHandler);
      if (stdoutBuf.trim()) {
        for (const ev of parseStreamLineAll(stdoutBuf)) opts.onEvent(ev);
      }
      if (timedOut) {
        const minutes = Math.round(timeoutMs / 60_000);
        opts.onEvent({ kind: "end", ok: false, error: `Turn timed out after ${minutes} minutes` });
      } else if (code !== 0) {
        opts.onEvent({ kind: "end", ok: false, error: stderrBuf.trim() || `claude exited ${code}` });
      }
      resolve();
    });
  });
}

function decoratePrompt(prompt: string, images?: string[]): string {
  if (!images?.length) return prompt;
  const refs = images.map((p) => `@${p}`).join("\n");
  return `${prompt}\n\nReference images:\n${refs}`;
}
