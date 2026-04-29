import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { getProject, readHistory, updateProject } from "../projects";
import { lastErrorLogPath, lastStdoutLogPath, projectDir } from "../paths";
import { runClaudeTurnWithRetry } from "../claudeCode";
import { resolveClaudeBin } from "../claudeBin";
import { hasBedrockAuth } from "../awsPreflight";
import { screenshotFrame } from "../frameScreenshot";
import type { ChatMessage, Frame } from "../types";

// Match /api/projects/:slug/frames/:frame/critique.
const URL_RE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/frames\/([a-z0-9][a-z0-9-]{0,62})\/critique$/i;

const DEFAULT_DEV_PORT = 5556;

function sizeToPx(size: Frame["size"]): number {
  const n = parseInt(size, 10);
  return Number.isFinite(n) && n > 0 ? n : 1440;
}

/**
 * Walk chat history backward, return the newest user message that attached
 * images. The images list may be absolute paths (from /api/uploads) or URLs;
 * we filter to paths that actually exist on disk so a stale history entry
 * doesn't trip up the claude turn.
 */
async function findReferenceImages(slug: string): Promise<string[]> {
  const history = await readHistory(slug);
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i] as ChatMessage;
    if (msg.role !== "user" || !msg.images?.length) continue;
    const existing: string[] = [];
    for (const p of msg.images) {
      if (!p || !p.startsWith("/")) continue;
      try {
        await fs.access(p);
        existing.push(p);
      } catch {}
    }
    if (existing.length) return existing;
  }
  return [];
}

function buildCritiquePrompt(args: {
  frameName: string;
  widthPx: number;
  refCount: number;
  screenshotPath: string;
  referencePaths: string[];
}): string {
  const refList = args.referencePaths.map((p, i) => `  [REF-${i + 1}] @${p}`).join("\n");
  return [
    `Refine the frame "${args.frameName}" to match the reference.`,
    "",
    "You're being called in a second pass: the frame already exists, and a",
    "reference image shows what it should look like. Compare the two images,",
    "then fix discrepancies in the frame source.",
    "",
    "Images attached below:",
    `  [CURRENT] @${args.screenshotPath}`,
    `      headless render of the frame at ${args.widthPx}px wide`,
    refList,
    `      ${args.refCount > 1 ? "reference images" : "reference image"} (Figma export, screenshot, or link capture)`,
    "",
    "Step 1 — Compare. Before editing anything, write a short findings list",
    "across these axes. For each, either say 'matches' or give 1–3 concrete",
    "discrepancies:",
    "  1. Layout — missing/extra elements, wrong positions, wrong flow",
    "  2. Spacing — padding, gaps, alignment",
    "  3. Typography — size, weight, hierarchy",
    "  4. Color & surface — backgrounds, borders, text, shadow",
    "  5. Component choice — did the frame reach for the right arcade primitive?",
    "",
    "Step 2 — Edit. Fix only what meaningfully moves the frame toward the",
    "reference. Do NOT restructure working code for pixel-perfect parity",
    "that won't change perceived quality. Small margin/color nits below the",
    "noise floor are fine to leave.",
    "",
    "Step 3 — Stop. If nothing meaningful differs, write 'DONE' and make no",
    "edits.",
    "",
    "Guardrails:",
    "  - Treat the CURRENT screenshot as ground truth for what was rendered.",
    "    If it looks different from your mental model of the source, trust",
    "    the screenshot.",
    "  - Stay within the arcade design system. Don't introduce hex colors or",
    "    hand-rolled components when a primitive exists.",
    "  - Do not re-read the reference from disk via Read — it's already",
    "    attached as an image.",
  ].join("\n");
}

function writeSse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function critiqueMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const match = req.url?.match(URL_RE);
    if (!match || req.method !== "POST") return next?.();
    const [, slug, frameSlug] = match;

    const project = await getProject(slug);
    if (!project) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: "Project not found" } }));
      return;
    }

    const frame = project.frames.find((f) => f.slug === frameSlug);
    if (!frame) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: "Frame not found" } }));
      return;
    }

    const referenceImages = await findReferenceImages(slug);
    if (!referenceImages.length) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          code: "no_reference",
          message:
            "No reference image found in chat history. Attach a reference (Figma export, screenshot, or link capture) to a prompt, then try again.",
        },
      }));
      return;
    }

    if (!(await hasBedrockAuth())) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      writeSse(res, "end", {
        kind: "end",
        ok: false,
        error:
          "No Bedrock auth detected. Export AWS_BEARER_TOKEN_BEDROCK or run `aws sso login`, then retry.",
      });
      res.end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let shot: Awaited<ReturnType<typeof screenshotFrame>>;
    try {
      writeSse(res, "narration", {
        kind: "narration",
        text: `Capturing headless screenshot of "${frame.name}" at ${sizeToPx(frame.size)}px…`,
      });
      shot = await screenshotFrame({
        projectSlug: slug,
        frameSlug,
        mode: project.mode,
        width: sizeToPx(frame.size),
        port: Number(process.env.ARCADE_STUDIO_PORT) || DEFAULT_DEV_PORT,
      });
    } catch (err: any) {
      writeSse(res, "end", {
        kind: "end",
        ok: false,
        error: `Screenshot failed: ${err?.message ?? String(err)}`,
      });
      res.end();
      return;
    }

    writeSse(res, "narration", {
      kind: "narration",
      text: `Comparing against ${referenceImages.length} reference image${referenceImages.length > 1 ? "s" : ""}…`,
    });

    const prompt = buildCritiquePrompt({
      frameName: frame.name,
      widthPx: sizeToPx(frame.size),
      refCount: referenceImages.length,
      screenshotPath: shot.path,
      referencePaths: referenceImages,
    });

    // Critique is a pure visual-reasoning task (compare screenshot vs
    // reference, spot discrepancies in spacing/color/typography). Pin to
    // Opus regardless of the user's chat-model preference — the latency
    // hit is worth it for refinement passes. `ARCADE_STUDIO_CRITIQUE_MODEL`
    // overrides for A/B testing.
    const model = process.env.ARCADE_STUDIO_CRITIQUE_MODEL?.trim() || "opus";

    let capturedSessionId: string | undefined;
    const narrationTexts: string[] = [];
    const toolLabels: string[] = [];
    let pendingEndEvent: { kind: "end"; ok: boolean; error?: string } | null = null;

    // Attach current-frame screenshot first, then the references, so the
    // "before/after" ordering in the prompt matches the image attachment
    // order claude sees.
    const imagesForTurn = [shot.path, ...referenceImages];

    try {
      await runClaudeTurnWithRetry({
        cwd: projectDir(slug),
        prompt,
        sessionId: project.sessionId,
        bin: resolveClaudeBin(),
        images: imagesForTurn,
        model,
        onEvent: (ev) => {
          if (ev.kind === "session") capturedSessionId = ev.sessionId;
          if (ev.kind === "narration") narrationTexts.push(ev.text);
          if (ev.kind === "tool_call") toolLabels.push(ev.pretty);
          if (ev.kind === "end") {
            pendingEndEvent = ev;
            return;
          }
          writeSse(res, ev.kind, ev);
        },
        onCrash: async (info) => {
          try {
            await fs.writeFile(
              lastErrorLogPath(slug),
              [
                `timestamp: ${new Date().toISOString()}`,
                `slug: ${slug}`,
                `frame: ${frameSlug}`,
                `kind: critique`,
                `exitCode: ${info.exitCode}`,
                `timedOut: ${info.timedOut}`,
                "",
                "--- stderr ---",
                info.stderr || "(empty)",
              ].join("\n"),
            );
            await fs.writeFile(lastStdoutLogPath(slug), info.rawStdout);
          } catch {}
        },
      });
    } catch (err: any) {
      pendingEndEvent = {
        kind: "end",
        ok: false,
        error: err?.message || String(err),
      };
    }

    if (capturedSessionId && capturedSessionId !== project.sessionId) {
      await updateProject(slug, { sessionId: capturedSessionId }).catch(() => {});
    }

    // Note: we intentionally do NOT append the critique turn to
    // chat-history.json. The user's chat history should stay a record of
    // human prompts, not auto-refine passes. The turn is still visible in
    // the SSE stream so the chat pane shows it live.
    void toolLabels;

    if (pendingEndEvent) {
      writeSse(res, "end", pendingEndEvent);
    }
    res.end();
  };
}
