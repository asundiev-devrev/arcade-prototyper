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

async function runFigmanage(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("figmanage", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout!.on("data", (c) => { stdout += c.toString(); });
    proc.stderr!.on("data", (c) => { stderr += c.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

export interface FigmaWhoamiResult {
  authenticated: boolean;
  user?: { email?: string; handle?: string };
}

export async function figmaWhoami(): Promise<FigmaWhoamiResult> {
  const r = await runFigmanage(["whoami", "--json"]);
  if (r.code !== 0) return { authenticated: false };
  try {
    const parsed = JSON.parse(r.stdout);
    return { authenticated: true, user: parsed?.user };
  } catch {
    return { authenticated: true };
  }
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

  let parsed: Record<string, string>;
  try { parsed = JSON.parse(r.stdout); }
  catch { throw new Error(`figmanage export returned unparseable JSON: ${r.stdout.slice(0, 200)}`); }

  const url = parsed[nodeId] ?? Object.values(parsed)[0];
  if (typeof url !== "string") {
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
 * Spawn `figmanage login` as a child process. The command opens a browser
 * for OAuth and stores credentials in the OS keychain. Returns a handle that
 * streams stdout/stderr lines via the `onLine` callback and resolves when
 * the child exits. Used by the `/api/figma/auth/login` endpoint.
 */
export interface FigmaLoginHandle {
  stop: () => void;
  done: Promise<{ code: number; ok: boolean }>;
}

export function figmaLoginStream(onLine: (line: string) => void): FigmaLoginHandle {
  const proc = spawn("figmanage", ["login"], { stdio: ["ignore", "pipe", "pipe"] });
  const push = (chunk: Buffer | string) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line) onLine(line);
    }
  };
  proc.stdout!.on("data", push);
  proc.stderr!.on("data", push);
  const done = new Promise<{ code: number; ok: boolean }>((resolve) => {
    proc.on("close", (code) => resolve({ code: code ?? 1, ok: code === 0 }));
    proc.on("error", () => resolve({ code: 1, ok: false }));
  });
  return {
    stop: () => { try { proc.kill("SIGTERM"); } catch {} },
    done,
  };
}
