import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { runClaudeTurnWithRetry } from "../claudeCode";
import { resolveClaudeBin } from "../claudeBin";
import { hasBedrockAuth } from "../awsPreflight";
import { getProject, updateProject, appendHistory, readHistory } from "../projects";
import { readGlobalSettings } from "./settings";
import { chatHistoryPath, lastErrorLogPath, lastStdoutLogPath, projectDir } from "../paths";
import { runComputerTurn } from "../devrev/computerAgent";
import { buildComputerContext } from "../devrev/computerContext";
import { summarizeFrameSource } from "../frameSummary";
import { runDriftCheck } from "../devrev/driftCheck";
import { pendingObjections, markStaleByFrame } from "../chimeIns";
import type { ChatMessage, ChimeIn } from "../types";
import type { StudioEvent } from "../../src/lib/streamJson";
import { extractFigmaUrl, extractFigmaUrls, detectInteractionIntent } from "../../src/lib/figmaUrl";
import { parseFigmaUrl } from "../figmaCli";
import { frameDir } from "../paths";
import { getFigmaIngest } from "../figmaIngest";
import { buildFigmaContextBlock } from "../figma/promptBlock";
import { shouldUseHiFi, buildHiFiDirective } from "../figma/fidelityDirective";
import { runFigmaKitEmitBranch } from "../figma/kitEmitBranch";
import { getFigmaSystemIngest, type FigmaSystemIngest } from "../figmaSystemIngest";
import { renderDesignMd } from "../figma/systemRender";
import { designMdPath } from "../paths";
import { startTurn, subscribe, getTurn, cancelTurn } from "../turnRegistry";
import { hasDeviationsSection, DEVIATIONS_MISSING_TRAILER } from "../deviationsContract";
import { prependEditContext } from "../editContext";
import {
  shouldRetryPhantomEdit,
  isMemoryOnlyPrompt,
  PHANTOM_EDIT_RETRY_PROMPT,
} from "../phantomEditRetry";
import type { Frame } from "../types";
import {
  snapshotProjectFiles,
  diffSnapshots,
  hasAnyChange,
  NO_CHANGES_TRAILER,
} from "../frameChangeContract";
import { recordTurnMetric } from "../metrics";
import { track } from "../../src/lib/telemetry/server";
import { hashSlug, truncate } from "../../src/lib/telemetry/redact";
import type { GenerationErrorKind } from "../../src/lib/telemetry/events";

// @Computer mention anywhere in the prompt routes to the DevRev agent. The
// mention is stripped before the prompt is sent to the agent. Per-turn switch:
// the next turn falls back to Claude unless re-mentioned.
const COMPUTER_MENTION = /@Computer\b/i;
const COMPUTER_MENTION_GLOBAL = /@Computer\b\s*/gi;

// #frame trigger is stripped from prompts for backward compatibility. Frame
// sources are now always included in the Computer context (see runComputerBranch).
const FRAME_TRIGGER_GLOBAL = /#frame\b\s*/gi;
// Total char budget for all frame summaries sent to the Computer agent.
// Summaries are tiny (components + visible text, not raw TSX), so this is a
// safety cap, not the usual operating size. We summarize rather than ship raw
// source because DevRev's execute-sync origin 406s on heavy/slow agent runs —
// an 18KB raw-TSX payload triggered a ~21s run that the origin rejected.
const FRAME_SUMMARY_CHAR_BUDGET = 12_000;

/**
 * Read every frame's `index.tsx` and return a concatenated STRUCTURAL SUMMARY
 * (imported composites + visible text per frame) — not the raw source. This is
 * what the Computer agent receives as project context. Returns "" if no frames
 * exist. See `frameSummary.ts` for why we summarize instead of sending code.
 */
async function readFrameSummaries(slug: string): Promise<string> {
  const framesDir = path.join(projectDir(slug), "frames");
  let entries: string[];
  try {
    entries = (await fs.readdir(framesDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return "";
  }

  const parts: string[] = [];
  let used = 0;
  for (const name of entries) {
    const file = path.join(framesDir, name, "index.tsx");
    let src: string;
    try { src = await fs.readFile(file, "utf-8"); } catch { continue; }
    const summary = summarizeFrameSource(name, src);
    if (used + summary.length > FRAME_SUMMARY_CHAR_BUDGET) {
      parts.push(`\n\n[remaining frame summaries omitted — budget reached]`);
      break;
    }
    parts.push(`\n\n${summary}`);
    used += summary.length;
  }
  return parts.join("");
}

/**
 * Pick the frame slug a snapshot diff is "about". Snapshot keys look like
 * `frames/<slug>/index.tsx` or `shared/...`. We prefer added frames, then
 * changed ones, and only consider paths under `frames/`. Returns null when
 * the diff touched nothing under frames/ (e.g. only shared/ changed).
 */
export function frameSlugFromDiff(diff: { added: string[]; changed: string[]; removed: string[] }): string | null {
  const pick = (paths: string[]): string | null => {
    for (const p of paths) {
      const m = p.match(/^frames\/([^/]+)\//);
      if (m) return m[1];
    }
    return null;
  };
  return pick(diff.added) ?? pick(diff.changed);
}

const STREAM_URL = /^\/api\/chat\/stream\/([a-z0-9][a-z0-9-]{0,62})$/i;
const STATUS_URL = /^\/api\/chat\/status\/([a-z0-9][a-z0-9-]{0,62})$/i;
const CANCEL_URL = /^\/api\/chat\/cancel\/([a-z0-9][a-z0-9-]{0,62})$/i;

export function chatMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (!req.url) return next?.();

    if (req.method === "GET") {
      const streamMatch = req.url.match(STREAM_URL);
      if (streamMatch) return handleStream(req, res, streamMatch[1].toLowerCase());
      const statusMatch = req.url.match(STATUS_URL);
      if (statusMatch) return handleStatus(res, statusMatch[1].toLowerCase());
    }

    if (req.url.startsWith("/api/chat") && req.method === "POST") {
      const cancelMatch = req.url.match(CANCEL_URL);
      if (cancelMatch) return handleCancel(res, cancelMatch[1].toLowerCase());
      return handleStart(req, res);
    }

    return next?.();
  };
}

async function handleStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  let body: { slug: string; prompt: string; images?: string[] };
  try {
    body = JSON.parse(buf);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request", message: "Invalid JSON" } }));
    return;
  }
  const { slug, prompt, images } = body;

  // Validate the body shape before any field is read (track() touches
  // prompt.length below). A valid-JSON POST missing/mistyping these fields
  // would otherwise throw an unhandled TypeError → 500 with no SSE + no
  // telemetry, which reads as a silent dead turn on the client.
  if (typeof slug !== "string" || !slug) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request", message: "slug is required" } }));
    return;
  }
  if (typeof prompt !== "string" || !prompt) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request", message: "prompt is required" } }));
    return;
  }
  if (images !== undefined && (!Array.isArray(images) || images.some((p) => typeof p !== "string"))) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request", message: "images must be an array of strings" } }));
    return;
  }

  const project = await getProject(slug);
  if (!project) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "Project not found" } }));
    return;
  }

  const running = getTurn(slug);
  if (running && running.status === "running") {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: { code: "turn_in_progress", message: "A turn is already running for this project." },
      turnId: running.id,
      // The live turn's prompt lets the client tell a genuine retry (same
      // prompt → latch onto the stream) apart from a NEW prompt typed while
      // the turn is still running (must not be silently dropped).
      prompt: running.prompt,
    }));
    return;
  }

  track({
    name: "prompt_submitted",
    props: {
      prompt_length: prompt.length,
      // Full prompt text — opted in for behavioral analysis (internal beta).
      // Capped at 2000 chars so a pasted-document prompt can't bloat the
      // payload / hit PostHog property limits.
      prompt_text: truncate(prompt, 2000),
      project_slug_hash: hashSlug(slug),
      frame_count_before: project.frames?.length ?? 0,
    },
  });

  const isComputerTurn = COMPUTER_MENTION.test(prompt);

  // Figma kit-emit turn: ANY prompt with a Figma URL (that isn't a @Computer
  // turn) imports the design deterministically — exact geometry from Figma's
  // REST data, real arcade-gen components where the curated mapping matches.
  // NO LLM, so it needs neither Bedrock auth nor the Claude subprocess. The
  // designer iterates on the imported frame with normal follow-up prompts
  // (which carry no URL and so take the Claude branch). See
  // server/figma/kitEmitBranch.ts.
  const figmaUrl = isComputerTurn ? null : extractFigmaUrl(prompt);
  const figmaParsed = figmaUrl ? parseFigmaUrl(figmaUrl) : null;
  const isKitEmitTurn = Boolean(figmaParsed);

  // Wire-an-interaction turn: a Figma-import prompt that ALSO asks for behavior
  // ("when you click X this modal appears <2nd url>"). The deterministic
  // importer can't produce interactivity and silently dropped both the prose
  // and any 2nd URL, so the interaction never got wired (and a re-ask imported
  // the modal as a separate frame). We import the screen + overlay
  // deterministically, then run ONE scoped LLM pass that only wires state.
  // Needs the LLM, so it's gated on Bedrock auth like a Claude turn.
  const figmaUrls = isComputerTurn ? [] : extractFigmaUrls(prompt);
  const isWireTurn =
    isKitEmitTurn && detectInteractionIntent(prompt) && figmaUrls.length >= 2;

  // Bedrock-auth pre-check applies only to Claude (Bedrock) turns; the
  // Computer agent uses the DevRev PAT, and kit-emit turns use no LLM at all.
  // We pass when either (a) a bearer token is exported for claude CLI to use,
  // or (b) SigV4 credentials resolve via `aws sts get-caller-identity`.
  // Otherwise we fail fast instead of spawning claude into a silent hang.
  if (!isComputerTurn && (!isKitEmitTurn || isWireTurn) && !(await hasBedrockAuth())) {
    track({ name: "generation_failed", props: { project_slug_hash: hashSlug(slug), error_kind: "bedrock_auth" } });
    const turn = startTurn(slug, {
      prompt,
      run: ({ end }) => {
        end({
          ok: false,
          error:
            "No Bedrock auth detected. Export AWS_BEARER_TOKEN_BEDROCK (keychain) or run `aws sso login` in the shell that launched studio, then reload.",
        });
      },
    });
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ turnId: turn.id, slug }));
    return;
  }

  // Persist the user message verbatim (with @Computer prefix intact) so
  // chat history reflects what the user actually typed.
  await appendHistory(slug, {
    id: `u-${Date.now()}`,
    role: "user",
    content: prompt,
    images,
    createdAt: new Date().toISOString(),
  });

  const turn = startTurn(slug, {
    prompt,
    run: ({ emit, end, signal }) => {
      const task = isWireTurn
        ? runFigmaWireBranch({
            emit,
            slug,
            prompt,
            urls: figmaUrls,
            project,
            signal,
          })
        : isKitEmitTurn
        ? runFigmaKitEmitBranch({
            emit,
            slug,
            fileKey: figmaParsed!.fileId,
            nodeId: figmaParsed!.nodeId,
            project,
            signal,
          })
        : isComputerTurn
        ? runComputerBranch({ emit, slug, prompt, project, signal })
        : runClaudeBranch({ emit, slug, prompt, images, project, signal });
      task.then(
        (result) => end(result),
        (err) => end({ ok: false, error: err?.message ?? String(err) }),
      );
    },
  });

  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ turnId: turn.id, slug }));
}

async function handleStream(req: IncomingMessage, res: ServerResponse, slug: string): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable nginx / proxy buffering if anything sits in front of us.
    "X-Accel-Buffering": "no",
  });
  // Flush headers so the browser's EventSource opens the connection even if
  // we have no events to send yet.
  (res as any).flushHeaders?.();

  const writeEvent = (ev: StudioEvent) => {
    res.write(`event: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`);
  };

  const turn = getTurn(slug);
  if (!turn) {
    // No turn at all for this slug — emit an idle marker so the client
    // immediately knows nothing is running, then keep the connection open
    // in case a turn starts. (Today the client opens /stream only when it
    // thinks there might be something; if that changes we'll revisit.)
    res.write(`event: idle\ndata: ${JSON.stringify({ kind: "idle" })}\n\n`);
    res.end();
    return;
  }

  // Replay everything buffered for this turn so a reconnect sees the full
  // activity from the start. The SSE "event:" field matches ev.kind so
  // client listeners behave the same for replayed and live events.
  const sub = subscribe(
    slug,
    (ev) => writeEvent(ev),
    () => {
      try { res.end(); } catch {}
    },
  );
  if (!sub) {
    // Race: turn evicted between getTurn and subscribe. Degrade gracefully.
    res.write(`event: idle\ndata: ${JSON.stringify({ kind: "idle" })}\n\n`);
    res.end();
    return;
  }

  // Send a "turn" header so the client can reset its local state before
  // the replay — avoids appending replayed events to a stale local buffer.
  res.write(
    `event: turn\ndata: ${JSON.stringify({
      kind: "turn",
      turnId: turn.id,
      prompt: turn.prompt,
      startedAt: turn.startedAt,
      status: turn.status,
      endedAt: turn.endedAt,
      error: turn.error,
    })}\n\n`,
  );
  for (const ev of sub.replay) writeEvent(ev);

  if (sub.status !== "running") {
    // Already terminal — no live events coming. Close immediately.
    res.end();
    return;
  }

  // Keep the socket alive across long silences (Bedrock first-token
  // latency can exceed 60s). Comment lines are SSE heartbeats — no event
  // is dispatched on the client.
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch {}
  }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    sub.unsubscribe();
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

function handleStatus(res: ServerResponse, slug: string): void {
  const turn = getTurn(slug);
  res.writeHead(200, { "Content-Type": "application/json" });
  if (!turn) {
    res.end(JSON.stringify({ status: "idle" }));
    return;
  }
  res.end(
    JSON.stringify({
      status: turn.status,
      turnId: turn.id,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      error: turn.error,
    }),
  );
}

function handleCancel(res: ServerResponse, slug: string): void {
  const ok = cancelTurn(slug);
  if (!ok) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "no_running_turn", message: "No turn is running for this project." },
      }),
    );
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ cancelled: true, slug }));
  track({ name: "generation_cancelled", props: { project_slug_hash: hashSlug(slug) } });
}

/** Map a finished/crashed turn to a telemetry error_kind. Pure + exported for test. */
export function classifyGenerationError(info: { error?: string; timedOut: boolean; exitCode: number | null }): GenerationErrorKind {
  if (info.timedOut) return "timeout";
  const msg = (info.error ?? "").toLowerCase();
  // Throttle BEFORE bedrock_auth: the throttle message mentions "Bedrock" too,
  // and a rate limit is a distinct, transient cause (wait + retry) — not an
  // auth/credential failure.
  if (/rate-limit|rate limit|too many requests|throttl/.test(msg)) return "throttled";
  if (/bedrock|credential|expired|auth|sso|token/.test(msg)) return "bedrock_auth";
  if (typeof info.exitCode === "number" && info.exitCode !== 0) return "cli_crash";
  if (/parse|json|unexpected token/.test(msg)) return "parser_error";
  return "other";
}

async function enrichPromptWithFigmaContext(
  prompt: string,
  images: string[],
  onNarration?: (text: string) => void,
): Promise<{ prompt: string; images: string[] }> {
  const url = extractFigmaUrl(prompt);
  if (!url) return { prompt, images };
  const parsed = parseFigmaUrl(url);
  if (!parsed) return { prompt, images };

  const ingest = await getFigmaIngest();
  let result = ingest.getCached(parsed.fileId, parsed.nodeId);
  if (!result) {
    // This fetch blocks turn start (3–15s on a cold Figma file). Tell the
    // user immediately so the chat pane shows progress instead of a frozen
    // "Working…" while figmanage + token resolve + PNG export run. Cheapest
    // possible perceived-latency win on the worst dead-air path.
    onNarration?.("Loading Figma design context…");
    // Wait for phase 1 (tree + tokens + PNG) only — typically 3–8s. Phase 2
    // (classifier) runs in the background and upgrades the cache in place
    // once done; the next turn on this URL will pick up composites for free.
    const pending = ingest.getPhase1Pending(parsed.fileId, parsed.nodeId)
      ?? ingest.ingestPhase1(parsed.fileId, parsed.nodeId, url);
    const raced = await Promise.race([
      pending,
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    if (raced && "ok" in raced && raced.ok) {
      const { ok, ...rest } = raced as any;
      void ok;
      result = rest;
    }
  }
  if (!result) {
    console.warn("[studio] figma ingest miss; proceeding without structured context");
    return { prompt, images };
  }

  const block = buildFigmaContextBlock(result);
  const nextImages = result.png ? [...images, result.png.path] : images;

  const parts = [`Figma context: ${result.composites.length} composites suggested`];
  if (result.diagnostics.warnings.length) {
    parts.push(`${result.diagnostics.warnings.length} diagnostic${result.diagnostics.warnings.length > 1 ? "s" : ""}`);
  }

  // High-fidelity mode: append a directive that suspends the speed shortcuts
  // and forces a real tree read + PNG-as-ground-truth + self-review. Fires on
  // explicit precise-implementation intent OR on a novel design (classifier
  // ran and found no high-confidence template to iterate on) — the latter is
  // the "exploring a new direction" case that otherwise churns to Cursor.
  // Ordinary "sketch me X" prompts that DO match a template keep the fast path.
  const hasHighConfidenceComposite = result.composites.some((c) => c.confidence === "high");
  let block2 = block;
  if (shouldUseHiFi(prompt, { classified: result.classified, hasHighConfidenceComposite })) {
    parts.push("high-fidelity mode");
    block2 = `${block}\n\n${buildHiFiDirective({
      fileKey: parsed.fileId,
      nodeId: parsed.nodeId,
      hasReferencePng: Boolean(result.png),
    })}`;
  }

  onNarration?.(parts.join(" · "));

  return { prompt: `${prompt}\n\n${block2}`, images: nextImages };
}

export interface SeedDesignMdInput {
  slug: string;
  fileKey: string | null;
  emit: (text: string) => void;
  ingest?: FigmaSystemIngest;
  /** Wall-clock cap for the whole sync. Defaults to 90s. */
  timeoutMs?: number;
}

/** Max wall-clock for a single design-system sync attempt. Covers
 *  fetchSources (4 figmanage reads + up to 8 PNG exports) + synthesize
 *  (LLM call, already timed out internally at 60s). If figmanage or the
 *  network is having a bad day, we skip the sync rather than hang the
 *  turn narration indefinitely. */
const DEFAULT_SEED_TIMEOUT_MS = 90_000;

/**
 * On the first turn that references a Figma file in a project without a
 * DESIGN.md, scan the whole file once, synthesize sections, and write the
 * result. Never overwrites an existing file — DESIGN.md is user-owned
 * after creation. Failures are emitted as narration lines; never thrown.
 *
 * Safe to fire-and-forget from the chat middleware: the main Claude turn
 * does NOT need DESIGN.md to be present to start — CLAUDE.md's
 * `@DESIGN.md` import is consulted by the next turn once this one finishes.
 * Blocking the main turn on this sync was the cause of multi-minute
 * "Working… with no output" hangs on large Figma files.
 */
export async function maybeSeedProjectDesignMd(input: SeedDesignMdInput): Promise<void> {
  const { slug, fileKey, emit } = input;
  const timeoutMs = input.timeoutMs ?? DEFAULT_SEED_TIMEOUT_MS;
  if (!fileKey) return;

  const targetPath = designMdPath(slug);
  try {
    await fs.stat(targetPath);
    // File exists — user owns it. Do nothing.
    return;
  } catch {
    // Not present; proceed.
  }

  emit("Scanning Figma design system…");

  const ingest = input.ingest ?? (await getFigmaSystemIngest());
  let timedOut = false;
  const timeoutSignal = new Promise<{ ok: false; reason: string }>((resolve) => {
    const t = setTimeout(() => {
      timedOut = true;
      resolve({ ok: false, reason: `timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    t.unref?.();
  });
  const outcome = await Promise.race([ingest.ingest(fileKey), timeoutSignal]);
  if (timedOut) {
    emit(`Design system sync skipped (${(outcome as { reason: string }).reason})`);
    return;
  }
  if (!outcome.ok) {
    emit(`Design system sync skipped (${outcome.reason})`);
    return;
  }

  const markdown = renderDesignMd(outcome.sections, outcome.source);
  const tmpPath = `${targetPath}.tmp`;
  try {
    await fs.writeFile(tmpPath, markdown);
    await fs.rename(tmpPath, targetPath);
  } catch (err: any) {
    emit(`Design system sync skipped (write error: ${err?.message ?? String(err)})`);
    try { await fs.unlink(tmpPath); } catch {}
    return;
  }

  const counts = [
    `${outcome.sections.colors.entries.length} colors`,
    `${outcome.sections.components.length} components`,
  ];
  emit(`Synced design system · ${counts.join(" · ")}`);
}

async function runClaudeBranch(ctx: {
  emit: (ev: StudioEvent) => void;
  slug: string;
  prompt: string;
  images?: string[];
  project: { sessionId?: string; frames?: Frame[] };
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
  const { emit, slug, project, signal } = ctx;
  const figmaUrl = extractFigmaUrl(ctx.prompt);
  const parsed = figmaUrl ? parseFigmaUrl(figmaUrl) : null;

  const narrate = (text: string) => emit({ kind: "narration", text });

  // The design-system sync seeds DESIGN.md for FUTURE turns via CLAUDE.md's
  // `@DESIGN.md` import — it does NOT need to complete before the current
  // turn starts. Launching it concurrently (fire-and-forget) keeps a slow
  // figmanage read or LLM synth call from blocking "Working…" for minutes.
  // maybeSeedProjectDesignMd has its own 90s wall-clock + narrates its own
  // progress/skip events; if the Claude turn ends before the sync finishes,
  // the emit calls become no-ops (turnRegistry drops events after terminal).
  void maybeSeedProjectDesignMd({
    slug,
    fileKey: parsed?.fileId ?? null,
    emit: narrate,
  }).catch((err) => {
    console.warn("[studio] unexpected seeder rejection:", err);
  });

  const enriched = await enrichPromptWithFigmaContext(ctx.prompt, ctx.images ?? [], narrate);
  const { images } = enriched;
  // Established projects (existing frames) get a prompt-region edit-context
  // block that (a) names the frames and (b) restates the two hard edit rules.
  // No-op on the first build and on right-click edits — see editContext.ts.
  const frameSlugs = (project.frames ?? []).map((f) => f.slug);
  const prompt = prependEditContext(enriched.prompt, frameSlugs);
  let capturedSessionId: string | undefined;
  const narrationTexts: string[] = [];
  const toolLabels: string[] = [];
  let pendingEnd: { ok: boolean; error?: string } | null = null;
  // Telemetry captured across the turn — persisted as one metrics row at the
  // end. The CLI's `turn_metrics` event carries ttft/duration/tokens/cost; the
  // onCrash callback tells us whether a stall fired.
  let lastMetrics: Extract<StudioEvent, { kind: "turn_metrics" }> | null = null;
  let didStall = false;
  let retries = 0;

  // Snapshot frame + shared files BEFORE the turn so we can detect whether
  // any file actually changed by the time the agent reports success. The
  // deviations contract checks the SHAPE of the agent's reply; this check
  // verifies that the reply corresponds to a real edit. Without it, an
  // agent that hallucinates a clean "Deviations: None" turn passes both
  // the contract and the user.
  const beforeSnapshot = await snapshotProjectFiles(projectDir(slug));

  let model: string | undefined;
  try {
    model = (await readGlobalSettings()).studio?.model;
  } catch {}

  try {
    await runClaudeTurnWithRetry({
      cwd: projectDir(slug),
      prompt,
      sessionId: project.sessionId,
      bin: resolveClaudeBin(),
      images,
      model,
      signal,
      onEvent: (ev) => {
        if (ev.kind === "session") capturedSessionId = ev.sessionId;
        if (ev.kind === "narration") narrationTexts.push(ev.text);
        if (ev.kind === "tool_call") toolLabels.push(ev.pretty);
        if (ev.kind === "turn_metrics") {
          // Keep the latest (a retried turn emits one per attempt; the last
          // reflects the attempt that actually finished). Not forwarded to the
          // stream — it's telemetry, not a UI event.
          lastMetrics = ev;
          return;
        }
        if (ev.kind === "end") {
          // Claude CLI's terminal `end` drives the registry's end via the
          // return value below — don't forward it into the event stream, or
          // subscribers would see two terminals.
          pendingEnd = ev.ok ? { ok: true } : { ok: false, error: ev.error };
          return;
        }
        emit(ev);
      },
      onCrash: async (info) => {
        if (info.stalled) didStall = true;
        if (info.stalled || info.timedOut) retries += 1;
        const body = [
          `timestamp: ${new Date().toISOString()}`,
          `slug: ${slug}`,
          `exitCode: ${info.exitCode}`,
          `timedOut: ${info.timedOut}`,
          `narrationCount: ${narrationTexts.length}`,
          `toolCallCount: ${toolLabels.length}`,
          `lastTool: ${toolLabels[toolLabels.length - 1] ?? "(none)"}`,
          `rawStdoutBytes: ${info.rawStdout.length}`,
          "",
          "--- stderr ---",
          info.stderr || "(empty)",
        ].join("\n");
        try {
          await fs.writeFile(lastErrorLogPath(slug), body);
          await fs.writeFile(lastStdoutLogPath(slug), info.rawStdout);
          console.warn(
            `[studio] claude turn failed for ${slug}; error log at ${lastErrorLogPath(slug)}, stdout at ${lastStdoutLogPath(slug)}`,
          );
        } catch (writeErr) {
          console.error("[studio] failed to persist crash log:", writeErr);
        }
      },
    });
  } catch (err: any) {
    const msg = err?.message || err?.stack || String(err) || "claude turn threw an unknown error";
    pendingEnd = { ok: false, error: msg };
    try {
      await fs.writeFile(
        lastErrorLogPath(slug),
        `timestamp: ${new Date().toISOString()}\nslug: ${slug}\n\n--- thrown error ---\n${err?.stack ?? msg}\n`,
      );
    } catch {}
  }

  const endResult = pendingEnd ?? { ok: false, error: "Claude turn exited without reporting a result." };
  // Snapshot the project files ONCE for a successful turn and reuse the diff
  // for both the metrics classification (below) and the no-change contract
  // check (further down). Each snapshot is a full recursive directory walk, so
  // computing it twice per turn was pure waste.
  let afterDiff: ReturnType<typeof diffSnapshots> | null = null;
  if (endResult.ok) {
    try {
      const afterSnapshot = await snapshotProjectFiles(projectDir(slug));
      afterDiff = diffSnapshots(beforeSnapshot, afterSnapshot);
    } catch { /* snapshot is best-effort — leave afterDiff null */ }
  }
  // Auto-expand: flatten any full-page composite in each changed frame so the
  // frame is directly editable. Derived from afterDiff (both added and changed
  // frames). Fire-and-forget: must not block the turn response; the frame
  // write triggers the normal Vite reload. Best-effort, never throws.
  // Dynamic import to avoid loading the expand module tree at chat.ts module-load
  // time (the registry imports prototype-kit composites, which breaks chat tests).
  if (endResult.ok && afterDiff) {
    const changedFrameSlugs = new Set<string>();
    for (const p of [...afterDiff.added, ...afterDiff.changed]) {
      const m = /^frames\/([^/]+)\/index\.tsx$/.exec(p);
      if (m) changedFrameSlugs.add(m[1]);
    }
    if (changedFrameSlugs.size > 0) {
      void import("../expand/postGenHook")
        .then(({ expandChangedFrames }) => expandChangedFrames(slug, Array.from(changedFrameSlugs)))
        .catch((err) => console.warn("[expand] post-gen hook failed to load/run:", err instanceof Error ? err.message : err));
    }
  }
  // Telemetry: classify the turn (build/edit/none) + measure the frame it
  // touched. Computed from the file snapshot regardless of narration so even a
  // silent build is counted.
  let turnType: "build" | "edit" | "none" = "none";
  let frameLines: number | undefined;
  if (endResult.ok && afterDiff) {
    try {
      const addedFrame = afterDiff.added.find((p) => /^frames\//.test(p));
      const changedFrame = afterDiff.changed.find((p) => /^frames\//.test(p));
      if (addedFrame) turnType = "build";
      else if (changedFrame) turnType = "edit";
      const touched = addedFrame ?? changedFrame;
      if (touched) {
        try {
          const src = await fs.readFile(path.join(projectDir(slug), touched), "utf-8");
          frameLines = src.split("\n").length;
        } catch { /* frame vanished — leave frameLines undefined */ }
      }
    } catch { /* metrics classification is best-effort */ }
  }
  void recordTurnMetric({
    at: new Date().toISOString(),
    slug,
    source: "claude",
    ok: endResult.ok,
    turnType,
    frameLines,
    stalled: didStall || undefined,
    retries: retries || undefined,
    promptChars: ctx.prompt.length,
    durationMs: lastMetrics?.durationMs,
    ttftMs: lastMetrics?.ttftMs,
    numTurns: lastMetrics?.numTurns,
    model: lastMetrics?.model,
    inputTokens: lastMetrics?.inputTokens,
    outputTokens: lastMetrics?.outputTokens,
    cacheCreationTokens: lastMetrics?.cacheCreationTokens,
    cacheReadTokens: lastMetrics?.cacheReadTokens,
    costUsd: lastMetrics?.costUsd,
  });
  if (endResult.ok) {
    track({
      name: "frame_generated",
      props: {
        project_slug_hash: hashSlug(slug),
        duration_ms: lastMetrics?.durationMs,
        model: lastMetrics?.model,
        tokens_input: lastMetrics?.inputTokens,
        tokens_output: lastMetrics?.outputTokens,
        turn_type: turnType,
        frame_lines: frameLines,
      },
    });
  } else {
    track({
      name: "generation_failed",
      props: {
        project_slug_hash: hashSlug(slug),
        duration_ms: lastMetrics?.durationMs,
        error_kind: classifyGenerationError({ error: endResult.error, timedOut: didStall, exitCode: null }),
        model: lastMetrics?.model,
      },
    });
  }
  if (endResult.ok) {
    // Enforce the deviations-section contract defined in templates/CLAUDE.md.tpl.
    // If the agent produced narration at all and that narration doesn't contain
    // a `### Deviations` heading, append a visible warning trailer. Emitting
    // the trailer as a live `narration` event AND pushing it to narrationTexts
    // keeps the SSE view in agreement with what readHistory() will return
    // after reload.
    const joined = narrationTexts.join("\n\n").trim();
    if (joined && !hasDeviationsSection(joined)) {
      emit({ kind: "narration", text: DEVIATIONS_MISSING_TRAILER.trimStart() });
      narrationTexts.push(DEVIATIONS_MISSING_TRAILER.trimStart());
    }

    // Verify the agent's claim against the filesystem. If the reply contains
    // narration (i.e. the agent told the user something happened) but no
    // file under frames/ or shared/ moved, surface a designer-facing warning
    // instead of a silent green checkmark. This catches two failure modes:
    // (a) hallucinated edits — the agent narrates a change without calling
    // any Edit/Write tool; (b) silent Edit failures — Claude's Edit tool
    // returns an error when `old_string` doesn't match uniquely, and the
    // agent sometimes responds by paraphrasing what it "would have done"
    // instead of retrying.
    if (joined && afterDiff) {
      let diff = afterDiff;

      // Phantom-edit self-correction: the agent emitted a complete reply (with
      // a ### Deviations section) but no file moved. Re-run the turn ONCE on
      // the same session with a corrective instruction before falling back to
      // the visible warning. Gated on a captured session id — a corrective
      // prompt on a fresh session would have no context and make things worse.
      //
      // One-shot: this branch is not inside a loop, so `alreadyRetried` is
      // hardcoded false — the retry can run at most once per turn. If this ever
      // gets refactored into a retry loop, thread a real flag through instead.
      if (
        capturedSessionId &&
        shouldRetryPhantomEdit({
          fileChanged: hasAnyChange(diff),
          claimsEdit: hasDeviationsSection(joined),
          memoryOnly: isMemoryOnlyPrompt(ctx.prompt),
          alreadyRetried: false,
        })
      ) {
        emit({ kind: "narration", text: "That change didn't land — reapplying it now…" });
        try {
          await runClaudeTurnWithRetry({
            cwd: projectDir(slug),
            prompt: PHANTOM_EDIT_RETRY_PROMPT,
            sessionId: capturedSessionId,
            bin: resolveClaudeBin(),
            model,
            signal,
            onEvent: (ev) => {
              if (ev.kind === "session") capturedSessionId = ev.sessionId;
              if (ev.kind === "narration") narrationTexts.push(ev.text);
              if (ev.kind === "tool_call") toolLabels.push(ev.pretty);
              // Keep the first attempt's metrics; the retry's end is
              // supplementary and must not flip the turn's terminal result.
              if (ev.kind === "turn_metrics") return;
              if (ev.kind === "end") return;
              emit(ev);
            },
          });
        } catch (err) {
          console.warn(`[studio] phantom-edit retry failed for ${slug}:`, err);
        }
        try {
          const afterRetry = await snapshotProjectFiles(projectDir(slug));
          diff = diffSnapshots(beforeSnapshot, afterRetry);
        } catch {
          /* snapshot best-effort — keep the prior diff */
        }
      }

      if (!hasAnyChange(diff)) {
        emit({ kind: "narration", text: NO_CHANGES_TRAILER.trimStart() });
        narrationTexts.push(NO_CHANGES_TRAILER.trimStart());
      }

      // A frame changed this turn — (1) stale-dismiss any pending chime-ins
      // about it (the objection may no longer apply) and (2) fire a silent
      // background drift check. Both are best-effort and never block the turn.
      const changedFrame = frameSlugFromDiff(diff);
      if (changedFrame) {
        try {
          const current = await getProject(slug);
          if (current) {
            const staled = markStaleByFrame(current.chimeIns ?? [], changedFrame);
            if (JSON.stringify(staled) !== JSON.stringify(current.chimeIns ?? [])) {
              await updateProject(slug, { chimeIns: staled });
            }
          }
        } catch (err) {
          console.warn(`[studio] stale-dismiss failed for ${slug}:`, err);
        }

        // Fire-and-forget: do not await. The turn ends; the chime-in (if any)
        // shows up a few seconds later via the chime-ins poll. The trailing
        // .catch guarantees no unhandled rejection can escape even if the
        // promise chain throws before runDriftCheck's own try/catch runs.
        void readFrameSummaries(slug)
          .then((frameSource) => runDriftCheck(slug, { frameSource, frameSlug: changedFrame }))
          .catch((err) => console.warn(`[studio] drift check rejected for ${slug}:`, err));
      }
    }

    const content = narrationTexts.join("\n\n").trim();
    if (content || toolLabels.length > 0) {
      await appendHistory(slug, {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: content || toolLabels.join(" · "),
        source: "claude",
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Persist the session id when it's new OR when it changed — the latter
  // happens when runClaudeTurnWithRetry recovers from a stale `--resume` by
  // starting a fresh session. Without the `!==` check the dead id would stay
  // in project.json and every subsequent turn would fail the same way.
  if (capturedSessionId && capturedSessionId !== project.sessionId) {
    await updateProject(slug, { sessionId: capturedSessionId });
  }

  return endResult;
}

/**
 * Wire-an-interaction turn: deterministic import of BOTH the screen and the
 * overlay, then ONE scoped LLM pass that only wires the click→show-overlay
 * state. Three steps:
 *
 *   1. Import the first URL as the screen frame (normal kit-emit → new frame).
 *   2. Import the second URL as a sibling `Overlay.tsx` INSIDE that frame's dir
 *      (target override → no new frame, pixel-exact, own assets/). reconcile
 *      keys frames on `frames/<dir>/index.tsx`, so a sibling .tsx is invisible
 *      to the viewport — exactly what "keep it on the same frame" needs.
 *   3. Run the Claude branch with a tightly-scoped prompt (NO Figma URL, so it
 *      stays in edit mode and never re-imports/rebuilds): import Overlay, add a
 *      useState, render it conditionally over a backdrop, wire the trigger.
 *
 * Why the LLM at all: interactivity (state + handlers) is behavior the
 * deterministic importer fundamentally cannot emit. But it never transcribes
 * pixels — both visuals come from the importer — so fidelity stays exact while
 * the LLM does only the wiring it's actually good at.
 *
 * Degrades safely: if the screen import fails we return its error; if the
 * overlay import fails we keep the screen and tell the user to wire manually;
 * if Bedrock auth is missing the gate upstream already short-circuited.
 */
async function runFigmaWireBranch(ctx: {
  emit: (ev: StudioEvent) => void;
  slug: string;
  prompt: string;
  urls: string[];
  project: { frames?: Array<{ slug: string }>; sessionId?: string };
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
  const { emit, slug, prompt, urls, project, signal } = ctx;
  const narrate = (text: string) => emit({ kind: "narration", text });

  const screenParsed = parseFigmaUrl(urls[0]);
  const overlayParsed = parseFigmaUrl(urls[1]);
  if (!screenParsed || !overlayParsed) {
    // Shouldn't happen (router parsed them), but never crash the turn.
    return runFigmaKitEmitBranch({
      emit, slug, fileKey: screenParsed?.fileId ?? "", nodeId: screenParsed?.nodeId ?? "", project, signal,
    });
  }

  // Step 1 — screen as a normal frame.
  const screen = await runFigmaKitEmitBranch({
    emit,
    slug,
    fileKey: screenParsed.fileId,
    nodeId: screenParsed.nodeId,
    project,
    signal,
  });
  if (!screen.ok || !screen.frameSlug) return screen;
  if (signal.aborted) return screen;

  // Step 2 — overlay as a sibling component INSIDE the screen frame's dir.
  const fdir = frameDir(slug, screen.frameSlug);
  narrate("Importing the overlay into the same frame…");
  const overlay = await runFigmaKitEmitBranch({
    emit,
    slug,
    fileKey: overlayParsed.fileId,
    nodeId: overlayParsed.nodeId,
    project,
    signal,
    target: { fdir, componentName: "Overlay", entryFileName: "Overlay.tsx" },
  });
  if (signal.aborted) return screen;
  if (!overlay.ok) {
    // Screen is fine; only the overlay import failed. Keep the screen, be honest.
    const msg =
      "Imported the screen, but couldn't import the overlay design — wire the interaction manually with a follow-up.";
    narrate(msg);
    await appendHistory(slug, {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: msg,
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  if (!(await hasBedrockAuth())) {
    // Defensive: the upstream gate should have caught this. Both visuals are
    // imported; just can't run the wiring pass.
    const msg =
      "Imported the screen and the overlay (`Overlay.tsx` in the same frame), but wiring needs the generator and no Bedrock auth was detected. Run `aws sso login`, then ask me to wire the click.";
    narrate(msg);
    await appendHistory(slug, {
      id: `a-${Date.now()}`, role: "assistant", content: msg, createdAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  // Step 3 — scoped LLM wiring pass. No Figma URL in this prompt, so the Claude
  // branch stays in edit mode (no re-import, no hi-fi rebuild). The designer's
  // original instruction is included verbatim so the trigger element is right.
  narrate("Wiring the interaction…");
  const fresh = (await getProject(slug)) ?? project;
  const wirePrompt = buildWirePrompt(screen.frameSlug, prompt);
  return runClaudeBranch({ emit, slug, prompt: wirePrompt, project: fresh, signal });
}

/**
 * Prompt for the wiring pass. Both the screen (`index.tsx`) and the overlay
 * (`Overlay.tsx`) already exist in the frame dir, pixel-exact. The LLM must
 * ONLY add interactivity: import Overlay, add open/close state, render it over a
 * dimmed backdrop when open, and wire the trigger named in the user's prompt.
 * It must NOT redesign either file or split anything into a new frame.
 *
 * Pure + exported for unit testing.
 */
export function buildWirePrompt(frameSlug: string, originalPrompt: string): string {
  return [
    `Two files already exist in \`frames/${frameSlug}/\`, both imported from Figma pixel-exact:`,
    `  - \`index.tsx\` — the screen (default export).`,
    `  - \`Overlay.tsx\` — the modal/overlay design (DEFAULT export).`,
    "",
    "Your ONLY job this turn is to wire the interaction the designer asked for. Edit `index.tsx` so that:",
    "1. It imports the overlay:  `import Overlay from \"./Overlay\";`  (it is a DEFAULT export — do NOT use named-import braces).",
    "2. It holds open/closed state with `React.useState(false)`.",
    "3. The trigger element named in the request gets an `onClick` that opens the overlay. Find that element in `index.tsx` by its visible label and attach the handler to it (or its nearest clickable wrapper).",
    "4. When open, the overlay renders ABOVE the screen, centered, over a semi-transparent dimmed backdrop (e.g. a fixed/absolute full-bleed `div` with `rgba(0,0,0,0.4)`), and clicking the backdrop closes it.",
    "",
    "Hard rules:",
    `- Edit ONLY \`frames/${frameSlug}/index.tsx\`. Do NOT create a new frame. Do NOT move the overlay into its own frame. Do NOT edit \`Overlay.tsx\`'s visuals.`,
    "- Do NOT redesign, re-layout, or restyle the screen. Preserve its existing markup, positions, inline styles, and `className`s exactly — you are only adding state, a handler, and the conditional overlay render.",
    "- Render `<Overlay />` as-is for the modal content; wrap it in the backdrop + centering, don't rebuild it.",
    "",
    "The designer's original request (for the trigger + intent):",
    originalPrompt,
  ].join("\n");
}

async function runComputerBranch(ctx: {
  emit: (ev: StudioEvent) => void;
  slug: string;
  prompt: string;
  project: { name?: string; theme?: string; computerConversationId?: string; chimeIns?: ChimeIn[] };
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
  const { emit, slug, prompt, project, signal } = ctx;
  const cleaned = prompt
    .replace(COMPUTER_MENTION_GLOBAL, "")
    .replace(FRAME_TRIGGER_GLOBAL, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return { ok: false, error: "Mention Computer with a question or instruction after @Computer." };
  }

  // Build full project context for the summon: project summary + pending
  // chime-ins + a structural summary of every frame + recent chat history.
  // We send summaries (components + visible text), NOT raw TSX — raw source
  // pushed agent/620 into a heavy run the execute-sync origin 406s on.
  const frameSource = await readFrameSummaries(slug);
  const history = await readHistory(slug);
  const recentHistory = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  const context = buildComputerContext({
    projectSummary: `Project: ${project.name ?? slug} (theme: ${project.theme ?? "arcade"}).`,
    pendingChimeIns: pendingObjections(project.chimeIns ?? []),
    frameSource,
    recentHistory,
  });
  const finalPrompt = `${context}\n\n---\n${cleaned}`;

  // Let the client know this turn is Computer-origin so it renders with the
  // Computer-branded components (thinking shimmer, markdown bubble, etc.).
  emit({ kind: "origin", source: "computer" });

  let endResult: { ok: boolean; error?: string } = { ok: true };

  const result = await runComputerTurn({
    prompt: finalPrompt,
    conversationId: project.computerConversationId,
    signal,
    onEvent: (ev) => {
      if (ev.kind === "end") {
        endResult = ev.ok ? { ok: true } : { ok: false, error: ev.error };
        return;
      }
      emit(ev);
    },
  });

  if (endResult.ok && result.assistantText.trim()) {
    await appendHistory(slug, {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: result.assistantText,
      source: "computer",
      createdAt: new Date().toISOString(),
    });
  }

  if (result.conversationId && result.conversationId !== project.computerConversationId) {
    await updateProject(slug, { computerConversationId: result.conversationId });
  }

  return endResult;
}
