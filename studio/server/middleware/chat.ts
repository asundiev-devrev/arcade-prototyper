import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { runClaudeTurnWithRetry } from "../claudeCode";
import { resolveClaudeBin } from "../claudeBin";
import { hasBedrockAuth } from "../awsPreflight";
import { getProject, updateProject } from "../projects";
import { readGlobalSettings } from "./settings";
import { chatHistoryPath, lastErrorLogPath, lastStdoutLogPath, projectDir } from "../paths";
import { ensureFigmaFileSelected } from "../figmaTabSelector";
import { runComputerTurn } from "../devrev/computerAgent";
import type { ChatMessage } from "../types";

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

export function chatMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (!req.url?.startsWith("/api/chat") || req.method !== "POST") return next?.();

    let buf = "";
    for await (const chunk of req) buf += chunk;
    const { slug, prompt, images } = JSON.parse(buf) as {
      slug: string; prompt: string; images?: string[];
    };

    const project = await getProject(slug);
    if (!project) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: "Project not found" } }));
      return;
    }

    const isComputerTurn = COMPUTER_MENTION.test(prompt);

    // Bedrock-auth pre-check applies only to Claude (Bedrock) turns; the
    // Computer agent uses the DevRev PAT. We pass when either (a) a bearer
    // token is exported for claude CLI to use, or (b) SigV4 credentials
    // resolve via `aws sts get-caller-identity`. Otherwise we fail fast
    // instead of spawning claude into a silent hang.
    if (!isComputerTurn && !(await hasBedrockAuth())) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(
        `event: end\ndata: ${JSON.stringify({
          kind: "end",
          ok: false,
          error:
            "No Bedrock auth detected. Export AWS_BEARER_TOKEN_BEDROCK (keychain) or run `aws sso login` in the shell that launched studio, then reload.",
        })}\n\n`
      );
      res.end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Persist the user message verbatim (with @Computer prefix intact) so
    // chat history reflects what the user actually typed.
    await appendHistory(slug, {
      id: `u-${Date.now()}`, role: "user", content: prompt, images,
      createdAt: new Date().toISOString(),
    });

    if (isComputerTurn) {
      await runComputerBranch({ res, slug, prompt, project });
    } else {
      await runClaudeBranch({ res, slug, prompt, images, project });
    }

    res.end();
  };
}

async function runClaudeBranch(ctx: {
  res: ServerResponse;
  slug: string;
  prompt: string;
  images?: string[];
  project: { sessionId?: string };
}) {
  const { res, slug, prompt, images, project } = ctx;

  try {
    const sel = await ensureFigmaFileSelected(prompt);
    if (sel.action === "closed-others") {
      console.log(`[studio] figma: closed ${sel.closed.length} other design tab(s) to isolate ${sel.fileKey}`);
    } else if (sel.action === "file-not-open") {
      console.log(`[studio] figma: file ${sel.fileKey} is NOT open in Figma desktop; reads will fail`);
    }
  } catch (err) {
    console.warn("[studio] figma tab selection failed:", err);
  }

  let capturedSessionId: string | undefined;
  const narrationTexts: string[] = [];
  const toolLabels: string[] = [];
  let pendingEndEvent: { kind: "end"; ok: boolean; error?: string } | null = null;

  // Look up the user's model selection (global settings.json). Silently
  // ignores any read/parse failure — an unset value is fine; claude CLI
  // will pick its default.
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
      onEvent: (ev) => {
        if (ev.kind === "session") capturedSessionId = ev.sessionId;
        if (ev.kind === "narration") narrationTexts.push(ev.text);
        if (ev.kind === "tool_call") toolLabels.push(ev.pretty);
        if (ev.kind === "end") {
          pendingEndEvent = ev;
          return;
        }
        res.write(`event: ${ev.kind}\n`);
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
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
    pendingEndEvent = { kind: "end", ok: false, error: msg };
    try {
      await fs.writeFile(
        lastErrorLogPath(slug),
        `timestamp: ${new Date().toISOString()}\nslug: ${slug}\n\n--- thrown error ---\n${err?.stack ?? msg}\n`,
      );
    } catch {}
  }

  const endEvent = pendingEndEvent as { kind: "end"; ok: boolean; error?: string } | null;
  if (endEvent?.ok) {
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

  if (endEvent) {
    res.write(`event: end\ndata: ${JSON.stringify(endEvent)}\n\n`);
  }
}

async function runComputerBranch(ctx: {
  res: ServerResponse;
  slug: string;
  prompt: string;
  project: { computerConversationId?: string };
}) {
  const { res, slug, prompt, project } = ctx;
  const wantsFrameContext = FRAME_TRIGGER.test(prompt);
  const cleaned = prompt
    .replace(COMPUTER_MENTION_GLOBAL, "")
    .replace(FRAME_TRIGGER_GLOBAL, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    res.write(
      `event: end\ndata: ${JSON.stringify({
        kind: "end",
        ok: false,
        error: "Mention Computer with a question or instruction after @Computer.",
      })}\n\n`,
    );
    return;
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
  res.write(`event: origin\ndata: ${JSON.stringify({ kind: "origin", source: "computer" })}\n\n`);

  let endEvent: { kind: "end"; ok: boolean; error?: string } | null = null;

  const result = await runComputerTurn({
    prompt: finalPrompt,
    conversationId: project.computerConversationId,
    onEvent: (ev) => {
      if (ev.kind === "end") {
        endEvent = ev;
        return;
      }
      res.write(`event: ${ev.kind}\n`);
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    },
  });

  if (endEvent && (endEvent as { ok: boolean }).ok && result.assistantText.trim()) {
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

  if (endEvent) {
    res.write(`event: end\ndata: ${JSON.stringify(endEvent)}\n\n`);
  }
}
