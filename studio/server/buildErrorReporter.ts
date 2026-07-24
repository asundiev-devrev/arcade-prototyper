import type { ViteDevServer } from "vite";
import path from "node:path";
import { projectsRoot } from "./paths";
import { runClaudeTurn } from "./claudeCode";
import { resolveClaudeBin } from "./claudeBin";
import { getProject, appendHistory } from "./projects";
import type { ChatMessage } from "./types";

/**
 * Maps `${slug}/${frameName}` to the last time we auto-prompted the agent
 * to fix that frame. Exported for tests; a single-process map is fine since
 * Vite's dev server is also single-process.
 */
export const lastAttempt = new Map<string, number>();

/**
 * Build the auto-fix prompt handed to the agent when a frame breaks.
 *
 * The old prompt was one line — "Fix the smallest thing that resolves it; do
 * not restructure." — and it back-fired on the most common crash class. An
 * `Element type is invalid … got: undefined` crash means a component/icon
 * reference evaluated to undefined (a hallucinated icon name, a default-vs-named
 * import mix-up, or a `Foo.Bar` member that doesn't exist on a real import).
 * The LITERALLY smallest change that makes such a crash go away is to DELETE the
 * broken reference — so the agent replaced an IconButton's icon with an empty
 * <span/> and a checkmark with a "+" character, quietly dropping UI the user
 * asked for. "Smallest change" rewarded vandalize-to-green.
 *
 * So the prompt now (a) forbids deleting/placeholder-swapping UI to silence the
 * error, and (b) for the undefined-element class, tells the agent the cause is
 * an import/name problem and to fix the NAME so the intended element renders.
 * Kept as a pure function so the wording is unit-testable.
 */
export function buildAutoFixPrompt(
  kind: "build" | "runtime",
  frameName: string,
  message: string,
): string {
  const lead =
    kind === "build"
      ? `The frame ${frameName} is failing to build with: ${message}.`
      : `The frame ${frameName} threw a runtime error: ${message}.`;

  const lines = [
    lead,
    "",
    "Fix the ROOT CAUSE with the smallest change that addresses it — do NOT restructure the frame.",
    "",
    "PRESERVE THE INTENDED UI. The frame rendered what the user asked for before this error;",
    "your job is to make that same UI work, not to make the error disappear by removing UI.",
    "Do NOT delete an element, empty out a component, or swap an icon/component for a placeholder",
    "(an empty <span/>, a text character like \"+\" or \"×\", a raw emoji, or a bare <div/>) to get",
    "past the error. Dropping the broken thing silences the crash but loses UI — that is a FAILURE,",
    "not a fix. If you cannot preserve an element, say so in your reply rather than quietly removing it.",
  ];

  // The undefined-element class is almost always an import problem; point the
  // agent at the cause so it corrects the name instead of stripping the JSX.
  if (/Element type is invalid|got:\s*undefined/i.test(message)) {
    lines.push(
      "",
      '"Element type is invalid … got: undefined" means a component or icon reference evaluated to',
      "undefined — almost always a WRONG or MISSING import: a hallucinated icon/component name, a",
      "default-vs-named import mix-up, or a `Foo.Bar` member that doesn't exist on a real import.",
      "Find the reference that is undefined and FIX THE IMPORT/NAME so the intended element renders:",
      "correct it to a real export (read the arcade/components barrel if unsure of the exact name) and",
      "import it. Removing the JSX or subbing a placeholder is the wrong fix.",
    );
  }

  return lines.join("\n");
}

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
  const err = (payload as {
    err?: { loc?: { file?: unknown }; id?: unknown; message?: unknown };
  } | null | undefined)?.err;

  // The failing file path lives in different places depending on which
  // transformer threw:
  //  - esbuild / classic Rollup plugins: `err.loc.file`
  //  - oxc (vite:oxc, the Vite 8 / rolldown-vite default): `loc` is UNDEFINED
  //    and the absolute path is in `err.id`. (Shape captured live from
  //    vite@8.0.13; a parse error like "Unterminated regular expression"
  //    only populates `id`.)
  // Prefer loc.file, fall back to id — otherwise every oxc syntax error in a
  // generated frame slips past the auto-fix and strands the user.
  const locFile = err?.loc?.file;
  const idFile = err?.id;
  const file = typeof locFile === "string" && locFile ? locFile : idFile;
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

  // oxc messages carry ANSI color escapes (they render a colored code frame in
  // a TTY). Strip them so the agent prompt + the chat detail row read as plain
  // text instead of `[31m…[0m` noise.
  const raw = typeof err?.message === "string" ? err.message : "unknown build error";
  // eslint-disable-next-line no-control-regex
  const message = raw.replace(/\u001b?\[[0-9;]*m/g, "");
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
  /** Overridable history writer; defaults to the real `appendHistory`. */
  appendHistory?: typeof appendHistory;
}

export async function handleViteError(
  payload: unknown,
  deps: BuildErrorReporterDeps = {},
): Promise<"skipped:not-frame" | "skipped:rate-limited" | "skipped:no-project" | "skipped:error" | "dispatched"> {
  const runTurn = deps.runTurn ?? runClaudeTurn;
  const now = deps.now ?? Date.now;
  const loadProject = deps.loadProject ?? getProject;
  const resolveBin = deps.resolveBin ?? resolveClaudeBin;
  const writeHistory = deps.appendHistory ?? appendHistory;

  const root = projectsRoot();
  const parsed = parseBuildError(payload, root);
  if (!parsed) return "skipped:not-frame";

  const { slug, frameName, message } = parsed;
  return dispatchAutoFix({
    slug,
    frameName,
    root,
    kind: "build",
    rawMessage: message,
    prompt: buildAutoFixPrompt("build", frameName, message),
    runTurn,
    now,
    loadProject,
    resolveBin,
    appendHistory: writeHistory,
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
  const writeHistory = deps.appendHistory ?? appendHistory;

  const root = projectsRoot();
  const clean = String(message ?? "").slice(0, 500) || "unknown runtime error";
  return dispatchAutoFix({
    slug,
    frameName,
    root,
    kind: "runtime",
    rawMessage: clean,
    prompt: buildAutoFixPrompt("runtime", frameName, clean),
    runTurn,
    now,
    loadProject,
    resolveBin,
    appendHistory: writeHistory,
  });
}

async function dispatchAutoFix(args: {
  slug: string;
  frameName: string;
  root: string;
  /** Whether the error came from Vite's compile-time path or a runtime crash
   *  in the iframe's React tree. Distinct labels in the user-facing system
   *  message so the chat reads "load" vs "runtime" the same way the iframe
   *  overlay does. */
  kind: "build" | "runtime";
  /** Raw error message — surfaced to the agent verbatim and persisted as the
   *  details of the user-facing system message so the user can expand and
   *  see what went wrong if they care. */
  rawMessage: string;
  prompt: string;
  runTurn: typeof runClaudeTurn;
  now: () => number;
  loadProject: typeof getProject;
  resolveBin: () => string;
  appendHistory: typeof appendHistory;
}): Promise<"skipped:rate-limited" | "skipped:no-project" | "skipped:error" | "dispatched"> {
  const {
    slug,
    frameName,
    root,
    kind,
    rawMessage,
    prompt,
    runTurn,
    now,
    loadProject,
    resolveBin,
    appendHistory: writeHistory,
  } = args;
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

  // Surface a chat-pane breadcrumb so the user can see that the studio is
  // self-healing. Without this the iframe just flips between a red wall and
  // a working frame and the user has no idea whether the agent is doing
  // anything in the background. System messages render as a muted centered
  // line in MessageList — quieter than a full assistant bubble, which is
  // what we want here (this is studio-driven, not user-prompted, work).
  const startMsg: ChatMessage = {
    id: `auto-fix-start:${key}:${t}`,
    role: "system",
    content: `Auto-repairing **${frameName}** — picked up a ${kind === "build" ? "load" : "runtime"} error and asked the agent to fix it.`,
    createdAt: new Date(t).toISOString(),
  };
  await writeHistory(slug, startMsg).catch((err) => {
    console.warn(`[buildErrorReporter] appendHistory(start) for ${key} failed:`, err);
  });
  // Best-effort: if the raw error is non-trivial, persist it as a follow-up
  // system row so the chat carries the diagnostic text. Helps when the
  // auto-fix doesn't actually resolve it and the user has to step in.
  if (rawMessage && rawMessage.length > 0) {
    await writeHistory(slug, {
      id: `auto-fix-detail:${key}:${t}`,
      role: "system",
      content: `↳ ${rawMessage}`,
      createdAt: new Date(t).toISOString(),
    }).catch(() => {});
  }

  try {
    await runTurn({
      cwd: path.join(root, slug),
      bin: resolveBin(),
      sessionId: project.sessionId,
      prompt,
      onEvent: () => {},
    });
    await writeHistory(slug, {
      id: `auto-fix-done:${key}:${now()}`,
      role: "system",
      content: `Auto-repair finished — check **${frameName}**. If it still looks wrong, tell the agent what to change.`,
      createdAt: new Date(now()).toISOString(),
    }).catch(() => {});
    return "dispatched";
  } catch (err) {
    console.warn(`[buildErrorReporter] runClaudeTurn for ${key} failed:`, err);
    await writeHistory(slug, {
      id: `auto-fix-failed:${key}:${now()}`,
      role: "system",
      content: `Auto-repair couldn't run for **${frameName}**. Try asking the agent directly to fix it.`,
      createdAt: new Date(now()).toISOString(),
    }).catch(() => {});
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
