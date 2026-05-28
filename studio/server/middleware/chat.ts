import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { runClaudeTurnWithRetry } from "../claudeCode";
import { resolveClaudeBin } from "../claudeBin";
import { hasBedrockAuth } from "../awsPreflight";
import { getProject, updateProject } from "../projects";
import { readGlobalSettings } from "./settings";
import { chatHistoryPath, lastErrorLogPath, lastStdoutLogPath, projectDir } from "../paths";
import { runComputerTurn } from "../devrev/computerAgent";
import type { ChatMessage } from "../types";
import type { StudioEvent } from "../../src/lib/streamJson";
import { extractFigmaUrl } from "../../src/lib/figmaUrl";
import { parseFigmaUrl } from "../figmaCli";
import { getFigmaIngest } from "../figmaIngest";
import { buildFigmaContextBlock } from "../figma/promptBlock";
import { getFigmaSystemIngest, type FigmaSystemIngest } from "../figmaSystemIngest";
import { renderDesignMd } from "../figma/systemRender";
import { designMdPath } from "../paths";
import { startTurn, subscribe, getTurn } from "../turnRegistry";
import { hasDeviationsSection, DEVIATIONS_MISSING_TRAILER } from "../deviationsContract";
import { recordChatEventForReplay, type ProjectRef } from "./chatRelayMirror";
import { resolveDevuFromPat } from "../relay/auth";
import { getDevRevPat } from "../secrets/keychain";
import type { RelayEvent } from "../relay/types";

// @Computer mention anywhere in the prompt routes to the DevRev agent. The
// mention is stripped before the prompt is sent to the agent. Per-turn switch:
// the next turn falls back to Claude unless re-mentioned.
const COMPUTER_MENTION = /@Computer\b/i;
const COMPUTER_MENTION_GLOBAL = /@Computer\b\s*/gi;

// #frame trigger injects the current project's frame sources into the prompt
// as context. Opt-in per turn.
const FRAME_TRIGGER = /#frame\b/i;
const FRAME_TRIGGER_GLOBAL = /#frame\b\s*/gi;
const FRAME_SOURCE_CHAR_BUDGET = 60_000;

async function appendHistory(slug: string, msg: ChatMessage) {
  const file = chatHistoryPath(slug);
  let existing: ChatMessage[] = [];
  try { existing = JSON.parse(await fs.readFile(file, "utf-8")); } catch {}
  existing.push(msg);
  await fs.writeFile(file, JSON.stringify(existing, null, 2));
}

/**
 * Read all frame `index.tsx` files for a project, concatenated as fenced
 * code blocks. Truncates with a budget so one huge frame can't blow past
 * the model's input limits. Returns an empty string if no frames exist.
 */
async function readFrameSources(slug: string): Promise<string> {
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
    const remaining = FRAME_SOURCE_CHAR_BUDGET - used;
    if (remaining <= 0) {
      parts.push(`\n\n[remaining frames omitted — char budget of ${FRAME_SOURCE_CHAR_BUDGET} reached]`);
      break;
    }
    const body = src.length > remaining
      ? `${src.slice(0, remaining)}\n\n[frame truncated — original was ${src.length} chars]`
      : src;
    parts.push(`\n\n### frame: ${name}\n\n\`\`\`tsx\n${body}\n\`\`\``);
    used += body.length;
  }
  return parts.join("");
}

const STREAM_URL = /^\/api\/chat\/stream\/([a-z0-9][a-z0-9-]{0,62})$/i;
const STATUS_URL = /^\/api\/chat\/status\/([a-z0-9][a-z0-9-]{0,62})$/i;

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
    }));
    return;
  }

  const isComputerTurn = COMPUTER_MENTION.test(prompt);

  // Bedrock-auth pre-check applies only to Claude (Bedrock) turns; the
  // Computer agent uses the DevRev PAT. We pass when either (a) a bearer
  // token is exported for claude CLI to use, or (b) SigV4 credentials
  // resolve via `aws sts get-caller-identity`. Otherwise we fail fast
  // instead of spawning claude into a silent hang.
  if (!isComputerTurn && !(await hasBedrockAuth())) {
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

  // Resolve the host devu once per turn so we can mirror events into the
  // multiplayer relay. If the PAT can't be resolved, the mirror simply
  // becomes a no-op — the host's own SSE flow is unaffected.
  let projectRef: ProjectRef | null = null;
  try {
    const pat = (await getDevRevPat()) ?? "";
    if (pat) {
      const host = await resolveDevuFromPat(pat);
      if (host) projectRef = { hostDevu: host.id, projectSlug: slug };
    }
  } catch {
    // Mirror is best-effort — never block a turn on the relay bridge.
  }

  // Late-bound turn id holder: startTurn calls init.run synchronously, so we
  // can't read turn.id from inside the run callback unless we stash it on a
  // shared object that's mutated immediately after startTurn returns.
  const turnIdHolder: { id: string } = { id: "" };

  const turn = startTurn(slug, {
    prompt,
    run: ({ emit, end, signal }) => {
      const wrappedEmit = projectRef
        ? (ev: StudioEvent) => {
            emit(ev);
            if (!turnIdHolder.id) return;
            const relayEv = mapStudioEventToRelayEvent(ev, turnIdHolder.id);
            if (relayEv) recordChatEventForReplay(projectRef!, relayEv);
          }
        : emit;
      const wrappedEnd = projectRef
        ? (result: { ok: boolean; error?: string }) => {
            if (turnIdHolder.id) {
              recordChatEventForReplay(projectRef!, {
                type: "turn_ended",
                turnId: turnIdHolder.id,
                ok: result.ok,
                error: result.error,
              });
            }
            end(result);
          }
        : end;
      const task = isComputerTurn
        ? runComputerBranch({ emit: wrappedEmit, slug, prompt, project, signal })
        : runClaudeBranch({ emit: wrappedEmit, slug, prompt, images, project, signal });
      task.then(
        (result) => wrappedEnd(result),
        (err) => wrappedEnd({ ok: false, error: err?.message ?? String(err) }),
      );
    },
  });
  turnIdHolder.id = turn.id;

  // Mirror the prompt_started marker after startTurn returns so we have a
  // turn id to attach. Guests joining mid-turn see this in cache_replay.
  if (projectRef) {
    recordChatEventForReplay(projectRef, {
      type: "prompt_started",
      turnId: turn.id,
      byDevu: projectRef.hostDevu,
      text: prompt,
    });
  }

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
  onNarration?.(parts.join(" · "));

  return { prompt: `${prompt}\n\n${block}`, images: nextImages };
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
  project: { sessionId?: string };
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
  const { prompt, images } = enriched;
  let capturedSessionId: string | undefined;
  const narrationTexts: string[] = [];
  const toolLabels: string[] = [];
  let pendingEnd: { ok: boolean; error?: string } | null = null;

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

  if (capturedSessionId && !project.sessionId) {
    await updateProject(slug, { sessionId: capturedSessionId });
  }

  return endResult;
}

async function runComputerBranch(ctx: {
  emit: (ev: StudioEvent) => void;
  slug: string;
  prompt: string;
  project: { computerConversationId?: string };
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
  const { emit, slug, prompt, project, signal } = ctx;
  const wantsFrameContext = FRAME_TRIGGER.test(prompt);
  const cleaned = prompt
    .replace(COMPUTER_MENTION_GLOBAL, "")
    .replace(FRAME_TRIGGER_GLOBAL, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return { ok: false, error: "Mention Computer with a question or instruction after @Computer." };
  }

  let finalPrompt = cleaned;
  if (wantsFrameContext) {
    const frameSources = await readFrameSources(slug);
    if (frameSources) {
      finalPrompt = `${cleaned}\n\n---\nFrame source (for context; cross-check against this):${frameSources}`;
    }
  }

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

/**
 * Adapt a StudioEvent (chat middleware's internal event shape) to a RelayEvent
 * (multiplayer wire shape). Returns null for events that don't have a clean
 * mapping — broadcasting only schema-valid events is safer than emitting
 * bogus ones that guests can't parse.
 *
 * - `narration` / `tool_call` / `tool_result` / `session` / `origin` →
 *   `agent_event` with the original StudioEvent embedded under `event`.
 * - `end` is handled by the wrapper around the registry's `end` callback,
 *   which translates it to `turn_ended` and includes the result; we return
 *   null here so it's not double-emitted.
 *
 * Frame writes/deletes happen via the host's filesystem (not the chat event
 * stream) so they're not mirrored here. They only flow through the relay
 * when a remote driver issues a `frame_write` command directly.
 */
function mapStudioEventToRelayEvent(ev: StudioEvent, turnId: string): RelayEvent | null {
  switch (ev.kind) {
    case "narration":
    case "tool_call":
    case "tool_result":
    case "session":
    case "origin":
      return { type: "agent_event", turnId, event: ev };
    case "end":
      // Translated to turn_ended by the wrapper; don't double-emit.
      return null;
    default: {
      const _exhaustive: never = ev;
      void _exhaustive;
      return null;
    }
  }
}
