import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

export function figmaCliDir(): string {
  return process.env.ARCADE_STUDIO_FIGMA_CLI_DIR ?? path.join(os.homedir(), "figma-cli");
}

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

async function run(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [path.join(figmaCliDir(), "src", "index.js"), ...args], {
      cwd: figmaCliDir(),
    });
    let stdout = "";
    proc.stdout.on("data", (c) => { stdout += c.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ stdout, code: code ?? 0 }));
  });
}

export async function daemonStatus(): Promise<{ connected: boolean }> {
  const r = await run(["daemon", "status"]);
  return { connected: /connected/i.test(r.stdout) };
}

export async function getNode(nodeId: string): Promise<unknown> {
  const r = await run(["get", nodeId]);
  if (r.code !== 0) throw new Error(`figma get failed (${r.code})`);
  return JSON.parse(r.stdout);
}

export async function nodeTree(nodeId: string, depth = 3): Promise<unknown> {
  const r = await run(["node", "tree", nodeId, "-d", String(depth)]);
  if (r.code !== 0) throw new Error(`figma tree failed (${r.code})`);
  return JSON.parse(r.stdout);
}

export async function exportNodePng(nodeId: string, outFile: string, scale = 2): Promise<string> {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const r = await run(["export", "node", nodeId, "-o", outFile, "-s", String(scale)]);
  if (r.code !== 0) throw new Error(`figma export failed (${r.code})`);
  return outFile;
}
