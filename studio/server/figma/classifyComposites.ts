import { spawn } from "node:child_process";
import type { CompactNode, CompositeSuggestion, CompositeConfidence } from "./types";
import { resolveClaudeBin } from "../claudeBin";

export interface ClassifierSpawnResult {
  text: string;
  exitCode: number | null;
}

export interface ClassifyOptions {
  /** Injected for tests — defaults to spawning `claude --bare --model <model>`. */
  spawn?: (prompt: string) => Promise<ClassifierSpawnResult>;
  model?: string;
  timeoutMs?: number;
}

export interface ClassifyResult {
  composites: CompositeSuggestion[];
  warnings: string[];
}

const CONFIDENCE: Record<string, CompositeConfidence> = {
  high: "high", medium: "medium", low: "low",
};

export async function classifyComposites(
  tree: CompactNode,
  compositeNames: string[],
  opts: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const spawner = opts.spawn ?? defaultSpawner(opts.model, opts.timeoutMs ?? 15_000);
  const prompt = buildPrompt(tree, compositeNames);
  const warnings: string[] = [];

  let reply: ClassifierSpawnResult;
  try {
    reply = await spawner(prompt);
  } catch (err: any) {
    return { composites: [], warnings: [`classifier failed: ${err?.message ?? String(err)}`] };
  }

  if (reply.exitCode !== 0) {
    return { composites: [], warnings: [`classifier failed with exit ${reply.exitCode}`] };
  }

  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(reply.text)); }
  catch {
    return { composites: [], warnings: [`classifier reply parse failed`] };
  }
  if (!Array.isArray(parsed)) {
    return { composites: [], warnings: [`classifier reply not an array`] };
  }

  const knownComposites = new Set(compositeNames);
  const validPaths = collectPaths(tree);

  const composites: CompositeSuggestion[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as any;
    const composite = String(r.composite ?? "");
    const path = String(r.path ?? "");
    const conf = CONFIDENCE[String(r.confidence ?? "").toLowerCase()];
    const reason = typeof r.reason === "string" ? r.reason : "";
    if (!knownComposites.has(composite)) {
      warnings.push(`dropped unknown composite "${composite}"`);
      continue;
    }
    if (!validPaths.has(path)) {
      warnings.push(`dropped invalid path "${path}" for ${composite}`);
      continue;
    }
    if (!conf) continue;
    composites.push({ composite, path, confidence: conf, reason });
  }
  return { composites, warnings };
}

function collectPaths(node: CompactNode, out: Set<string> = new Set()): Set<string> {
  out.add(node.id);
  node.children?.forEach((c) => collectPaths(c, out));
  return out;
}

function buildPrompt(tree: CompactNode, composites: string[]): string {
  return [
    "You are classifying a Figma node tree against a fixed catalog of React composites.",
    "Return ONLY a JSON array. No prose. No markdown fences. Each entry:",
    `  { "composite": "<one of catalog>", "path": "<node id from tree>",`,
    `    "confidence": "high|medium|low", "reason": "<<=80 chars>" }`,
    "Rules:",
    "- Only suggest composites from the catalog.",
    "- Paths must be exact ids from the tree below.",
    "- Prefer fewer, higher-confidence suggestions over many low ones.",
    "- If nothing fits, return `[]`.",
    "",
    `Catalog: ${composites.join(", ")}`,
    "",
    "Tree:",
    "```json",
    JSON.stringify(tree),
    "```",
  ].join("\n");
}

function extractJson(text: string): string {
  // The CLI occasionally wraps the JSON in prose/markdown fences. Pull the
  // first `[...]` segment we can find.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const stripped = fence ? fence[1] : text;
  const m = stripped.match(/\[[\s\S]*\]/);
  return m ? m[0] : stripped.trim();
}

function defaultSpawner(modelOpt: string | undefined, timeoutMs: number) {
  return (prompt: string) =>
    new Promise<ClassifierSpawnResult>((resolve) => {
      const model = modelOpt
        ?? process.env.ARCADE_STUDIO_CLASSIFIER_MODEL?.trim()
        ?? "haiku";
      const bin = resolveClaudeBin();
      const proc = spawn(bin, ["--bare", "--model", model, "--print", prompt], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      proc.stdout.on("data", (c) => { text += c.toString(); });
      // Swallow stderr — we never surface it to the user; only exit code matters.
      proc.stderr.on("data", () => {});
      const timer = setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} }, timeoutMs);
      proc.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ text, exitCode });
      });
      proc.on("error", () => resolve({ text: "", exitCode: -1 }));
    });
}
