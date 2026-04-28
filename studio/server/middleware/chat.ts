import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { runClaudeTurn } from "../claudeCode";
import { resolveClaudeBin } from "../claudeBin";
import { ssoIsValid } from "../awsPreflight";
import { getProject, updateProject } from "../projects";
import { chatHistoryPath, projectDir } from "../paths";
import { ensureFigmaFileSelected } from "../figmaTabSelector";
import type { ChatMessage } from "../types";

async function appendHistory(slug: string, msg: ChatMessage) {
  const file = chatHistoryPath(slug);
  let existing: ChatMessage[] = [];
  try { existing = JSON.parse(await fs.readFile(file, "utf-8")); } catch {}
  existing.push(msg);
  await fs.writeFile(file, JSON.stringify(existing, null, 2));
}

export function chatMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (!req.url?.startsWith("/api/chat") || req.method !== "POST") return next?.();

    // Pre-check AWS SSO before doing any real work: claude's Bedrock path
    // will stall for several seconds before failing if credentials are
    // expired. Synthesize an SSE `end ok:false` so the frontend's
    // AuthExpiredNotice (matches /sso|credential|expired|unauthorized/i)
    // fires immediately.
    if (!(await ssoIsValid())) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(
        `event: end\ndata: ${JSON.stringify({
          kind: "end",
          ok: false,
          error: "AWS SSO credentials expired. Run aws sso login --profile dev.",
        })}\n\n`
      );
      res.end();
      return;
    }

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

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    await appendHistory(slug, {
      id: `u-${Date.now()}`, role: "user", content: prompt, images,
      createdAt: new Date().toISOString(),
    });

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
    let pendingEndEvent: unknown = null;

    try {
      await runClaudeTurn({
        cwd: projectDir(slug),
        prompt,
        sessionId: project.sessionId,
        bin: resolveClaudeBin(),
        images,
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
      });
    } catch (err: any) {
      pendingEndEvent = { kind: "end", ok: false, error: err.message };
    }

    const endEvent = pendingEndEvent as { kind: "end"; ok: boolean; error?: string } | null;
    if (endEvent?.ok) {
      const content = narrationTexts.join("\n\n").trim();
      if (content || toolLabels.length > 0) {
        await appendHistory(slug, {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: content || toolLabels.join(" · "),
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
    res.end();
  };
}
