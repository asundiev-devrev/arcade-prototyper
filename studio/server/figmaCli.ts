import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface ParsedFigmaUrl { fileId: string; nodeId: string; }

export function parseFigmaUrl(url: string): ParsedFigmaUrl | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("figma.com")) return null;
    const m = u.pathname.match(/\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
    const nodeParam = u.searchParams.get("node-id");
    if (!m || !nodeParam) return null;
    return { fileId: m[1], nodeId: nodeParam.replace(/-/g, ":") };
  } catch { return null; }
}

/**
 * Run figmanage and collect its output. Treats spawn failures (ENOENT,
 * ENOEXEC) the same as a non-zero exit — resolves with `code: -1` and
 * the error message in stderr. The alternative (rejecting the promise)
 * cascades into a 500 response from the middleware, which the
 * FigmaConnectButton renders as "Figma error — retry" — misleading
 * when the real state is "figmanage is just not installed on PATH."
 */
async function runFigmanage(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let proc;
    try {
      proc = spawn("figmanage", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err: any) {
      resolve({ stdout: "", stderr: `spawn failed: ${err?.message ?? String(err)}`, code: -1 });
      return;
    }
    proc.stdout!.on("data", (c) => { stdout += c.toString(); });
    proc.stderr!.on("data", (c) => { stderr += c.toString(); });
    proc.on("error", (err: any) => {
      resolve({ stdout, stderr: stderr + `\nspawn error: ${err?.message ?? String(err)}`, code: -1 });
    });
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

export interface FigmaWhoamiResult {
  authenticated: boolean;
  user?: { email?: string; handle?: string };
}

export async function figmaWhoami(): Promise<FigmaWhoamiResult> {
  // figmanage whoami does NOT support --json (it's plain-text only:
  // "User: Name\nEmail: x@y\nAuth: PAT"). Exit code is the source of
  // truth for authenticated vs not. We parse the plain-text output
  // for the email when we can, but authenticated-ness doesn't depend
  // on parsing succeeding.
  const r = await runFigmanage(["whoami"]);
  if (r.code !== 0) {
    // Log spawn failures and non-zero exits server-side so we can
    // diagnose "Figma error" states from the launcher log instead of
    // guessing. Authenticated false is the frontend's cue to show
    // "Connect Figma"; the log tells us whether that's because the
    // user isn't logged in OR because figmanage itself is broken.
    if (r.code === -1) {
      console.warn("[studio] figmanage whoami spawn failed:", r.stderr.trim());
    } else {
      console.warn(`[studio] figmanage whoami exited ${r.code}:`, r.stderr.trim() || r.stdout.trim());
    }
    return { authenticated: false };
  }
  // Parse the plain-text output. Format (as of figmanage 1.4.2):
  //   User:  Andrey Sundiev
  //   Email: andrey.sundiev@devrev.ai
  //   Auth:  PAT
  const emailMatch = r.stdout.match(/^\s*Email:\s*(\S+)/m);
  return { authenticated: true, user: emailMatch ? { email: emailMatch[1] } : undefined };
}

export async function getNode(fileKey: string, nodeId: string): Promise<unknown> {
  const r = await runFigmanage(["reading", "get-nodes", fileKey, nodeId, "--json"]);
  if (r.code !== 0) throw new Error(`figmanage get-nodes failed (${r.code}): ${r.stderr}`);
  try { return JSON.parse(r.stdout); }
  catch { throw new Error(`figmanage get-nodes returned unparseable JSON: ${r.stdout.slice(0, 200)}`); }
}

export async function nodeTree(fileKey: string, nodeId: string, depth = 3): Promise<unknown> {
  const r = await runFigmanage(["reading", "get-nodes", fileKey, nodeId, "--depth", String(depth), "--json"]);
  if (r.code !== 0) throw new Error(`figmanage get-nodes (tree) failed (${r.code}): ${r.stderr}`);
  try { return JSON.parse(r.stdout); }
  catch { throw new Error(`figmanage get-nodes (tree) returned unparseable JSON: ${r.stdout.slice(0, 200)}`); }
}

export async function exportNodePng(
  fileKey: string,
  nodeId: string,
  outFile: string,
  scale = 2,
): Promise<string> {
  const r = await runFigmanage([
    "export", "nodes", fileKey, nodeId,
    "--format", "png",
    "--scale", String(scale),
    "--json",
  ]);
  if (r.code !== 0) throw new Error(`figmanage export failed (${r.code}): ${r.stderr}`);

  let parsed: unknown;
  try { parsed = JSON.parse(r.stdout); }
  catch { throw new Error(`figmanage export returned unparseable JSON: ${r.stdout.slice(0, 200)}`); }

  let url: string | undefined;
  if (Array.isArray(parsed)) {
    // figmanage current shape: [{ node_id, url }]
    const entry = parsed.find((e: any) => e?.node_id === nodeId) ?? parsed[0];
    url = typeof entry?.url === "string" ? entry.url : undefined;
  } else if (parsed && typeof parsed === "object") {
    // legacy dict shape: { [nodeId]: url }
    const dict = parsed as Record<string, unknown>;
    const v = dict[nodeId] ?? Object.values(dict)[0];
    url = typeof v === "string" ? v : undefined;
  }

  if (!url) {
    throw new Error(`figmanage export produced no URL for node ${nodeId}`);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, buf);
  return outFile;
}

/**
 * Clear figmanage's stored credentials (PAT + any cached cookies).
 * Used by the "Remove" button in Settings. Non-zero exit surfaces the
 * message so the UI can render an inline error rather than silently
 * claiming success.
 */
export async function figmaLogout(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let output = "";
    let proc;
    try {
      proc = spawn("figmanage", ["logout"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err: any) {
      resolve({ ok: false, message: `spawn failed: ${err?.message ?? String(err)}` });
      return;
    }
    proc.stdout!.on("data", (c) => { output += c.toString(); });
    proc.stderr!.on("data", (c) => { output += c.toString(); });
    proc.on("error", (err: any) => {
      resolve({ ok: false, message: `spawn error: ${err?.message ?? String(err)}` });
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ ok: true, message: output.trim() });
      else resolve({ ok: false, message: output.trim() || `figmanage exited ${code}` });
    });
  });
}

/**
 * Log in to figmanage using a Figma Personal Access Token.
 *
 * figmanage's `login` command is interactive: it reads Chrome cookies first,
 * then prompts for a PAT on stdin. We used to spawn it with stdin closed
 * and stream stdout via SSE, but that just hit the PAT prompt with EOF and
 * exited immediately — the "click Connect Figma, button reverts in half a
 * second, nothing happens" bug beta testers hit.
 *
 * Instead, pipe the PAT to stdin with `--pat-only` (skip the cookie step
 * entirely), let figmanage validate it against Figma's API, and return the
 * exit state. The output already contains a useful error message on failure
 * ("PAT invalid or expired") so we surface it unchanged to the UI.
 */
export async function figmaLoginWithPat(pat: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let output = "";
    let proc;
    try {
      proc = spawn("figmanage", ["login", "--pat-only"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: any) {
      resolve({ ok: false, message: `spawn failed: ${err?.message ?? String(err)}` });
      return;
    }
    proc.stdout!.on("data", (c) => { output += c.toString(); });
    proc.stderr!.on("data", (c) => { output += c.toString(); });
    proc.on("error", (err: any) => {
      resolve({ ok: false, message: `spawn error: ${err?.message ?? String(err)}` });
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: output.trim() });
      } else {
        // Pick the most specific line figmanage printed. Its output has a
        // predictable structure; the "PAT invalid or expired" line (or
        // similar) is the signal we want to show the user.
        const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const specific =
          lines.find((l) => /invalid|expired|unauthorized|denied|error/i.test(l)) ??
          lines[lines.length - 1] ??
          `figmanage exited ${code}`;
        resolve({ ok: false, message: specific });
      }
    });
    // Feed the PAT and close stdin so figmanage's readline resolves.
    try {
      proc.stdin!.write(pat.trim() + "\n");
      proc.stdin!.end();
    } catch {
      // Write errors will surface through the close handler.
    }
  });
}

/**
 * Fetch the Figma file's local variable definitions. Returns `null` rather
 * than throwing on figmanage failure — variables are best-effort input to
 * token resolution. A missing response degrades to "tokens left raw" and
 * does not block ingest.
 */
export async function getVariables(fileKey: string): Promise<any | null> {
  const r = await runFigmanage(["reading", "get-variables", fileKey, "--json"]);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout); }
  catch { return null; }
}
