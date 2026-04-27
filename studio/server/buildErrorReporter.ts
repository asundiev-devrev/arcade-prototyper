import type { ViteDevServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectsRoot } from "./paths";
import { runClaudeTurn } from "./claudeCode";
import { getProject } from "./projects";

const ARCADE_GEN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// NOTE: duplicated with studio/server/middleware/chat.ts::claudeBin().
// If a shared helper is introduced, consolidate both callers.
function resolveClaudeBin(): string {
  return process.env.ARCADE_STUDIO_CLAUDE_BIN
    ?? path.resolve(ARCADE_GEN_ROOT, "node_modules", ".bin", "claude");
}

/**
 * Maps `${slug}/${frameName}` to the last time we auto-prompted the agent
 * to fix that frame. Exported for tests; a single-process map is fine since
 * Vite's dev server is also single-process.
 */
export const lastAttempt = new Map<string, number>();

/** Minimum ms between auto-prompts for the same frame. */
export const AUTO_RETRY_WINDOW_MS = 60_000;

/**
 * Parse a `vite:error` payload into `{ slug, frameName, message }` when the
 * failing file is inside a studio project's frames directory. Returns null
 * for any other error source so we don't accidentally prompt the agent.
 */
export function parseBuildError(
  payload: unknown,
  projectsRootAbs: string,
): { slug: string; frameName: string; message: string } | null {
  const err = (payload as { err?: { loc?: { file?: unknown }; message?: unknown } } | null | undefined)?.err;
  const file = err?.loc?.file;
  if (typeof file !== "string" || !file) return null;

  const rel = path.relative(projectsRootAbs, file);
  // path.relative returns a ".."-prefixed path if `file` is outside the root.
  // It also returns an absolute path on Windows for cross-volume paths.
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;

  const parts = rel.split(path.sep);
  // Expect: <slug>/frames/<frameName>/...
  if (parts.length < 3) return null;
  const [slug, framesSeg, frameName] = parts;
  if (!slug || framesSeg !== "frames" || !frameName) return null;

  const message = typeof err?.message === "string" ? err.message : "unknown build error";
  return { slug, frameName, message };
}

export interface BuildErrorReporterDeps {
  /** Overridable for tests; defaults to the real `runClaudeTurn`. */
  runTurn?: typeof runClaudeTurn;
  /** Overridable clock for rate-limit tests. */
  now?: () => number;
  /** Overridable project resolver; defaults to reading from disk. */
  loadProject?: typeof getProject;
  /** Overridable bin resolver. */
  resolveBin?: () => string;
}

export async function handleViteError(
  payload: unknown,
  deps: BuildErrorReporterDeps = {},
): Promise<"skipped:not-frame" | "skipped:rate-limited" | "skipped:no-project" | "skipped:error" | "dispatched"> {
  const runTurn = deps.runTurn ?? runClaudeTurn;
  const now = deps.now ?? Date.now;
  const loadProject = deps.loadProject ?? getProject;
  const resolveBin = deps.resolveBin ?? resolveClaudeBin;

  const root = projectsRoot();
  const parsed = parseBuildError(payload, root);
  if (!parsed) return "skipped:not-frame";

  const { slug, frameName, message } = parsed;
  return dispatchAutoFix({
    slug,
    frameName,
    root,
    prompt: `The frame ${frameName} is failing to build with: ${message}. Fix the smallest thing that resolves it; do not restructure.`,
    runTurn,
    now,
    loadProject,
    resolveBin,
  });
}

/**
 * Dispatch an auto-fix turn when a frame throws at runtime (caught by
 * FrameErrorBoundary and posted back via postMessage).
 */
export async function handleRuntimeError(
  slug: string,
  frameName: string,
  message: string,
  deps: BuildErrorReporterDeps = {},
): Promise<"skipped:rate-limited" | "skipped:no-project" | "skipped:error" | "dispatched"> {
  const slugOk = /^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug);
  const frameOk = /^[a-z0-9][a-z0-9-]{0,62}$/i.test(frameName);
  if (!slugOk || !frameOk) return "skipped:error";

  const runTurn = deps.runTurn ?? runClaudeTurn;
  const now = deps.now ?? Date.now;
  const loadProject = deps.loadProject ?? getProject;
  const resolveBin = deps.resolveBin ?? resolveClaudeBin;

  const root = projectsRoot();
  const clean = String(message ?? "").slice(0, 500) || "unknown runtime error";
  return dispatchAutoFix({
    slug,
    frameName,
    root,
    prompt: `The frame ${frameName} threw a runtime error: ${clean}. Fix the smallest thing that resolves it; do not restructure.`,
    runTurn,
    now,
    loadProject,
    resolveBin,
  });
}

async function dispatchAutoFix(args: {
  slug: string;
  frameName: string;
  root: string;
  prompt: string;
  runTurn: typeof runClaudeTurn;
  now: () => number;
  loadProject: typeof getProject;
  resolveBin: () => string;
}): Promise<"skipped:rate-limited" | "skipped:no-project" | "skipped:error" | "dispatched"> {
  const { slug, frameName, root, prompt, runTurn, now, loadProject, resolveBin } = args;
  const key = `${slug}/${frameName}`;
  const t = now();
  const prev = lastAttempt.get(key) ?? 0;
  if (prev > t - AUTO_RETRY_WINDOW_MS) return "skipped:rate-limited";
  lastAttempt.set(key, t);

  let project;
  try {
    project = await loadProject(slug);
  } catch (err) {
    console.warn(`[buildErrorReporter] getProject(${slug}) failed:`, err);
    return "skipped:error";
  }
  if (!project) return "skipped:no-project";

  try {
    await runTurn({
      cwd: path.join(root, slug),
      bin: resolveBin(),
      sessionId: project.sessionId,
      prompt,
      onEvent: () => {},
    });
    return "dispatched";
  } catch (err) {
    console.warn(`[buildErrorReporter] runClaudeTurn for ${key} failed:`, err);
    return "skipped:error";
  }
}

export function attachBuildErrorReporter(server: ViteDevServer): void {
  server.ws.on("vite:error", (payload) => {
    // Fire-and-forget: the dev server's ws handler can't await, and a stuck
    // await here would pile up and leak memory on repeated errors.
    void handleViteError(payload);
  });
}
