import { randomUUID } from "node:crypto";
import type { StudioEvent } from "../../src/lib/streamJson";
import { getDevRevPat } from "../secrets/keychain";

/**
 * Computer agent adapter for DevRev's `ai-agents.events.execute-sync` endpoint.
 *
 * - Body: `{ agent, event: { input_message: { message } }, session_object }`
 * - `session_object` is a client-controlled stable id; reuse the same value
 *   across turns to continue a conversation. We persist it as
 *   `project.computerConversationId`.
 * - Response is SSE. Each event is a JSON object:
 *   `{ response: "progress" | "message" | "error", ... }`
 *   We forward progress skill events as `tool_call` and the final `message`
 *   as `narration`, so the existing chat UI renders them like a Claude turn.
 */

const COMPUTER_AGENT_ID = "don:core:dvrv-us-1:devo/0:ai_agent/198";
const ENDPOINT = "https://api.devrev.ai/internal/ai-agents.events.execute-sync";

export interface RunComputerTurnOptions {
  prompt: string;
  /** Existing session_object to continue a thread; undefined for a new one. */
  conversationId?: string;
  onEvent: (e: StudioEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RunComputerTurnResult {
  /** session_object to persist on the project. */
  conversationId?: string;
  /** Full assistant text to persist in chat history. Empty on error. */
  assistantText: string;
}

interface AgentSseEvent {
  response?: "error" | "message" | "progress";
  message?: string;
  error?: { error?: string; message?: string };
  progress?: {
    progress_state?: "skill_executed" | "skill_triggered";
    skill_executed?: { skill_name?: string };
    skill_triggered?: { skill_name?: string; skill?: string };
  };
}

export async function runComputerTurn(
  opts: RunComputerTurnOptions,
): Promise<RunComputerTurnResult> {
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  if (!pat) {
    opts.onEvent({
      kind: "end",
      ok: false,
      error: "No DevRev PAT configured. Set one in Studio settings.",
    });
    return { assistantText: "" };
  }

  const sessionObject = opts.conversationId || `arcade-studio-${randomUUID()}`;

  const body = {
    agent: COMPUTER_AGENT_ID,
    event: { input_message: { message: opts.prompt } },
    session_object: sessionObject,
  };

  const controller = new AbortController();
  const abortHandler = () => controller.abort();
  opts.signal?.addEventListener("abort", abortHandler);
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Emit the session id up front so the frontend sees it even if the stream
  // errors partway through.
  opts.onEvent({ kind: "session", sessionId: sessionObject });

  let assistantText = "";

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: pat,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const raw = await res.text();
      const extracted = extractHttpError(raw);
      const shown = extracted ? `${extracted} | raw=${raw.slice(0, 300)}` : (raw.slice(0, 400) || res.statusText);
      opts.onEvent({
        kind: "end",
        ok: false,
        error: `DevRev ai-agents.events.execute-sync ${res.status}: ${shown}`,
      });
      return { conversationId: sessionObject, assistantText: "" };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let errorMsg: string | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Parse SSE frames separated by blank lines.
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const payload = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!payload) continue;
        let ev: AgentSseEvent;
        try { ev = JSON.parse(payload) as AgentSseEvent; } catch { continue; }

        if (ev.response === "progress") {
          const label = progressLabel(ev);
          if (label) {
            opts.onEvent({ kind: "tool_call", tool: "Computer", pretty: label });
          }
          continue;
        }
        if (ev.response === "message") {
          if (typeof ev.message === "string" && ev.message.trim()) {
            assistantText = ev.message;
            opts.onEvent({ kind: "narration", text: ev.message });
          }
          continue;
        }
        if (ev.response === "error") {
          errorMsg = ev.error?.error || ev.error?.message || "agent error";
          continue;
        }
        // Some error responses arrive without a `response` field, e.g.
        // `{"message":"route not found"}`. Treat missing `response` as a
        // protocol-level error and surface the message verbatim.
        if (!ev.response && typeof ev.message === "string") {
          errorMsg = ev.message;
          continue;
        }
      }
    }

    if (errorMsg) {
      opts.onEvent({ kind: "end", ok: false, error: errorMsg });
      return { conversationId: sessionObject, assistantText: "" };
    }

    opts.onEvent({ kind: "end", ok: true });
    return { conversationId: sessionObject, assistantText };
  } catch (err: unknown) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    const msg = aborted
      ? "Computer turn was cancelled or timed out"
      : err instanceof Error ? err.message : String(err);
    opts.onEvent({ kind: "end", ok: false, error: msg });
    return { conversationId: sessionObject, assistantText: "" };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abortHandler);
  }
}

function progressLabel(ev: AgentSseEvent): string | null {
  const p = ev.progress;
  if (!p) return null;
  if (p.progress_state === "skill_triggered") {
    const name = p.skill_triggered?.skill_name || p.skill_triggered?.skill;
    return name ? `Using ${name}` : "Working";
  }
  if (p.progress_state === "skill_executed") {
    const name = p.skill_executed?.skill_name;
    return name ? `Finished ${name}` : null;
  }
  return null;
}

function extractHttpError(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const d = JSON.parse(raw) as { message?: string; error?: { message?: string } | string };
    if (typeof d.message === "string") return d.message;
    if (typeof d.error === "string") return d.error;
    if (d.error && typeof d.error === "object" && typeof d.error.message === "string") {
      return d.error.message;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
