import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioEvent } from "../lib/streamJson";

export type ErrorKind = "auth" | "generic";

export type ChatTurnItem =
  | { kind: "narration"; text: string }
  | {
      kind: "tool";
      tool: string;
      pretty: string;
      /** Raw call input (full path / full command / full pattern). */
      details?: string;
      /** Full tool result once it arrives. `undefined` while call is in-flight. */
      ok?: boolean;
      snippet?: string;
      /** Wall-clock time the tool call was dispatched, for elapsed display. */
      startedAt: number;
      /** Wall-clock time the tool result arrived. */
      endedAt?: number;
    };

export interface StreamState {
  busy: boolean;
  error: string | null;
  errorKind?: ErrorKind;
  narrations: string[];
  items: ChatTurnItem[];
  lastEvent: StudioEvent | null;
  lastPrompt: string;
  /** Which agent is producing the current/last turn. Defaults to claude. */
  source: "claude" | "computer";
}

const AUTH_EXPIRED = /sso|credential|expired|unauthorized/i;

export function classifyError(message: string): ErrorKind {
  return AUTH_EXPIRED.test(message) ? "auth" : "generic";
}

function appendItem(items: ChatTurnItem[], next: ChatTurnItem): ChatTurnItem[] {
  if (next.kind === "tool") {
    const last = items[items.length - 1];
    if (
      last &&
      last.kind === "tool" &&
      last.tool === next.tool &&
      last.pretty === next.pretty &&
      last.details === next.details
    ) {
      return items;
    }
  }
  return [...items, next];
}

function attachResultToLastTool(
  items: ChatTurnItem[],
  ok: boolean,
  snippet?: string,
): ChatTurnItem[] {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const entry = items[i];
    if (entry.kind === "tool" && entry.ok === undefined) {
      const updated = [...items];
      updated[i] = { ...entry, ok, snippet, endedAt: Date.now() };
      return updated;
    }
  }
  return items;
}

export function useChatStream(slug: string) {
  const [state, setState] = useState<StreamState>({
    busy: false,
    error: null,
    errorKind: undefined,
    narrations: [],
    items: [],
    lastEvent: null,
    lastPrompt: "",
    source: "claude",
  });
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const lastImagesRef = useRef<string[] | undefined>(undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      readerRef.current?.cancel().catch(() => {});
    };
  }, []);

  const safeSetState = useCallback((updater: (s: StreamState) => StreamState) => {
    if (mountedRef.current) setState(updater);
  }, []);

  const send = useCallback(async (prompt: string, images?: string[]) => {
    if (busyRef.current) return;
    busyRef.current = true;
    abortRef.current = new AbortController();
    lastImagesRef.current = images;
    safeSetState((s) => ({
      ...s,
      busy: true,
      error: null,
      errorKind: undefined,
      narrations: [],
      items: [],
      lastEvent: null,
      lastPrompt: prompt,
      source: "claude",
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, prompt, images }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`chat request failed: ${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
      readerRef.current = reader;
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let ev: StudioEvent;
          try { ev = JSON.parse(dataLine.slice(6)) as StudioEvent; }
          catch { continue; }
          safeSetState((s) => {
            if (ev.kind === "origin") {
              return { ...s, lastEvent: ev, source: ev.source };
            }
            if (ev.kind === "narration") {
              return {
                ...s,
                lastEvent: ev,
                narrations: [...s.narrations, ev.text],
                items: appendItem(s.items, { kind: "narration", text: ev.text }),
              };
            }
            if (ev.kind === "tool_call") {
              return {
                ...s,
                lastEvent: ev,
                narrations: [...s.narrations, ev.pretty],
                items: appendItem(s.items, {
                  kind: "tool",
                  tool: ev.tool,
                  pretty: ev.pretty,
                  details: ev.details,
                  startedAt: Date.now(),
                }),
              };
            }
            if (ev.kind === "tool_result") {
              return {
                ...s,
                lastEvent: ev,
                items: attachResultToLastTool(s.items, ev.ok, ev.snippet),
              };
            }
            if (ev.kind === "end" && !ev.ok) {
              const err = ev.error ?? "unknown error";
              return { ...s, busy: false, error: err, errorKind: classifyError(err) };
            }
            if (ev.kind === "end") return { ...s, busy: false, lastEvent: ev };
            return { ...s, lastEvent: ev };
          });
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        safeSetState((s) => ({ ...s, busy: false }));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        safeSetState((s) => ({ ...s, busy: false, error: message, errorKind: classifyError(message) }));
      }
    } finally {
      busyRef.current = false;
      readerRef.current = null;
      safeSetState((s) => (s.busy ? { ...s, busy: false } : s));
    }
  }, [slug, safeSetState]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    readerRef.current?.cancel().catch(() => {});
  }, []);

  const retry = useCallback(() => {
    if (busyRef.current) return;
    const prompt = state.lastPrompt;
    if (!prompt) return;
    void send(prompt, lastImagesRef.current);
  }, [send, state.lastPrompt]);

  const refine = useCallback(async (frameSlug: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    abortRef.current = new AbortController();
    const label = `Refining "${frameSlug}" against reference…`;
    safeSetState((s) => ({
      ...s,
      busy: true,
      error: null,
      errorKind: undefined,
      narrations: [],
      items: [],
      lastEvent: null,
      lastPrompt: label,
      source: "claude",
    }));

    try {
      const res = await fetch(
        `/api/projects/${slug}/frames/${frameSlug}/critique`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortRef.current.signal,
        },
      );

      if (!res.ok) {
        let msg = `critique request failed: ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error?.message) msg = body.error.message;
        } catch {}
        throw new Error(msg);
      }

      if (!res.body) throw new Error("critique: empty response body");

      const reader = res.body.getReader();
      readerRef.current = reader;
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let ev: StudioEvent;
          try { ev = JSON.parse(dataLine.slice(6)) as StudioEvent; }
          catch { continue; }
          safeSetState((s) => {
            if (ev.kind === "narration") {
              return {
                ...s,
                lastEvent: ev,
                narrations: [...s.narrations, ev.text],
                items: appendItem(s.items, { kind: "narration", text: ev.text }),
              };
            }
            if (ev.kind === "tool_call") {
              return {
                ...s,
                lastEvent: ev,
                narrations: [...s.narrations, ev.pretty],
                items: appendItem(s.items, {
                  kind: "tool",
                  tool: ev.tool,
                  pretty: ev.pretty,
                  details: ev.details,
                  startedAt: Date.now(),
                }),
              };
            }
            if (ev.kind === "tool_result") {
              return {
                ...s,
                lastEvent: ev,
                items: attachResultToLastTool(s.items, ev.ok, ev.snippet),
              };
            }
            if (ev.kind === "end" && !ev.ok) {
              const err = ev.error ?? "unknown error";
              return { ...s, busy: false, error: err, errorKind: classifyError(err) };
            }
            if (ev.kind === "end") return { ...s, busy: false, lastEvent: ev };
            return { ...s, lastEvent: ev };
          });
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        safeSetState((s) => ({ ...s, busy: false }));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        safeSetState((s) => ({ ...s, busy: false, error: message, errorKind: classifyError(message) }));
      }
    } finally {
      busyRef.current = false;
      readerRef.current = null;
      safeSetState((s) => (s.busy ? { ...s, busy: false } : s));
    }
  }, [slug, safeSetState]);

  return { state, send, cancel, retry, refine };
}
