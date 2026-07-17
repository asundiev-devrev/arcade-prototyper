import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, ChatMessage } from "../../server/types";
import { useChatStream, type StreamState } from "./useChatStream";
import {
  firstSummaryLine,
  shouldTriggerVisualNoOpRetry,
} from "../components/viewport/visualNoOp";
import { narrationClaimsVisualChange } from "../../server/visualNoOpRetry";

type ChatStream = ReturnType<typeof useChatStream>;

export interface ProjectShellSource {
  project: Project | null;
  chatHistory: ChatMessage[];
  chat: StreamState;
  chatStream: ChatStream;
  send: (prompt: string, images?: string[]) => void;
  refresh: () => Promise<void>;
  /** Buffer a visual-no-op candidate for a frame (called by FrameCard via the
   *  Viewport prop-thread). Only a candidate — the turn-end effect decides. */
  onVisualNoOp: (frameSlug: string) => void;
  /** Set to a frame slug when a change updated the code but the rendered frame
   *  stayed pixel-identical THROUGH one corrective retry. Drives the soft
   *  VisualNoOpBanner. Cleared on the next user send. */
  visualNoOpBannerForFrame: string | null;
}

/**
 * Aggregate the host-side data sources that `ProjectDetail` needs:
 *
 *   - `GET /api/projects/:slug` for the `Project` record (header title,
 *     theme, viewport mode, share/devmode chrome).
 *   - `GET /api/projects/:slug/history` for persisted chat messages.
 *   - `useChatStream(slug)` for the live SSE turn stream + `send()`.
 *
 * Frame polling stays in `useFrames` (1.5s) and is consumed inside
 * `Viewport` — that's intentional: it'd waste a render cycle to lift
 * here without observable benefit.
 */
export function useProjectFromHost(slug: string): ProjectShellSource {
  const [project, setProject] = useState<Project | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  // Pass the project's known frames to `useChatStream` so the reducer can
  // resolve streamed `tool_input_partial` filePaths to a frame slug. We
  // use `project?.frames ?? []` rather than `useFrames` here because
  // `useFrames` lives inside `Viewport` (intentional — see comment below)
  // and the project record is refreshed on every turn anyway, which is
  // recent-enough for the live cursor to find the right slug.
  const projectFrames = project?.frames ?? [];
  const chatStream = useChatStream(slug, projectFrames);
  const { state: chat, send: rawSend } = chatStream;

  // ── Visual-no-op detection (the code changed but the render didn't) ─────────
  // A candidate buffered by FrameCard when an edit's fingerprint matched the
  // prior render. The turn-end effect below decides whether to auto-retry.
  const noOpCandidate = useRef<string | null>(null);
  // The turn id we last acted on (POSTed a retry for, or classified as the
  // corrective) — so the same `done` can't be handled twice.
  const handledTurn = useRef<string | null>(null);
  // TRUE while we're expecting the corrective turn's `done`. Turns are
  // serialized per slug (the server 409s a second concurrent turn), so the
  // FIRST new turn to end after we POST a retry IS the corrective — we don't
  // need its id from the POST body (which could fail to parse). Its `done` is
  // banner-only; it can never itself trigger another retry → no loop.
  const awaitingCorrective = useRef(false);
  const [visualNoOpBannerForFrame, setVisualNoOpBannerForFrame] = useState<string | null>(null);

  const onVisualNoOp = useCallback((frameSlug: string) => {
    noOpCandidate.current = frameSlug;
  }, []);

  // Reset per-turn state when a genuinely NEW user turn starts. Keyed on the
  // turn id transitioning to a running phase — this fires regardless of WHICH
  // send path was used (the main ChatPane composer sends via the raw stream,
  // NOT the wrapper below), so it's the send-path-independent reset. It must
  // NOT reset for the corrective turn (which we started ourselves), so it's
  // gated on `!awaitingCorrective.current`.
  const lastSeenTurn = useRef<string | null>(null);
  useEffect(() => {
    const turnId = chat.turnId;
    if (!turnId || turnId === lastSeenTurn.current) return;
    lastSeenTurn.current = turnId;
    if (awaitingCorrective.current) return; // this new turn IS the corrective — keep state
    // A fresh user turn — clear any stale candidate/banner/one-shot.
    noOpCandidate.current = null;
    handledTurn.current = null;
    setVisualNoOpBannerForFrame(null);
  }, [chat.turnId]);

  // Nicety wrapper (used by a few non-composer send paths); the reset above is
  // the load-bearing one, so this only needs to forward.
  const send = rawSend;

  // On a clean turn end: if this is the CORRECTIVE turn → banner-only (never
  // re-POST). Otherwise, if a no-op candidate is buffered AND the agent's
  // summary claimed a visual change → POST the corrective retry + reconnect.
  useEffect(() => {
    if (chat.phase !== "done") return;
    const turnId = chat.turnId;
    if (!turnId || turnId === handledTurn.current) return;

    // The corrective turn ended. If it ALSO left a no-op candidate, the retry
    // didn't move pixels → surface the honest banner. Never re-POST.
    if (awaitingCorrective.current) {
      handledTurn.current = turnId;
      awaitingCorrective.current = false;
      if (noOpCandidate.current) setVisualNoOpBannerForFrame(noOpCandidate.current);
      return;
    }

    const candidate = noOpCandidate.current;
    const summaryClaimsVisual = narrationClaimsVisualChange(
      firstSummaryLine(chat.narrations),
    );
    if (
      !shouldTriggerVisualNoOpRetry({
        candidateBuffered: candidate != null,
        phase: chat.phase,
        summaryClaimsVisual,
        alreadyTriggeredThisTurn: false,
      })
    ) {
      return;
    }
    handledTurn.current = turnId;
    awaitingCorrective.current = true;
    // Clear the candidate so a fresh onVisualNoOp during the corrective turn is
    // distinguishable (a re-noop → banner).
    noOpCandidate.current = null;
    let cancelled = false;
    void (async () => {
      try {
        await fetch("/api/chat/visual-noop-retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, frame: candidate, userTurnId: turnId }),
        });
        if (cancelled) return;
        chatStream.reconnect();
      } catch {
        // Best-effort — a failed retry just means no auto-correction this turn.
        awaitingCorrective.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.phase, chat.turnId, slug]);

  // Generation counter guards `refresh` against two races:
  //   - slug change mid-flight (a stale response would otherwise overwrite
  //     the new slug's project record);
  //   - unmount mid-flight (would set state on an unmounted component).
  // Each `refresh()` invocation captures a fresh `gen`; we only commit the
  // result when the captured value still matches the live `genRef`.
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Bump generation on unmount so any in-flight refresh resolves into
      // a stale gen check and bails out.
      genRef.current += 1;
    };
  }, []);
  // Bump generation when slug changes so any in-flight refresh tied to the
  // previous slug is discarded before its response can land.
  useEffect(() => {
    genRef.current += 1;
  }, [slug]);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    const res = await fetch(`/api/projects/${slug}`);
    if (!res.ok) return;
    const p = (await res.json()) as Project;
    if (!mountedRef.current || gen !== genRef.current) return;
    setProject(p);
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh persisted chat history whenever a turn transitions out of
  // `running`. Mirrors the logic that lived in ChatPane before extraction.
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      const r = await fetch(`/api/projects/${slug}/history`);
      if (!cancelled && r.ok) setChatHistory(await r.json());
    }
    if (chat.phase !== "running") void pull();
    const onInviteRefresh = () => void pull();
    window.addEventListener(
      "arcade-studio:refresh-chat-history",
      onInviteRefresh,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        "arcade-studio:refresh-chat-history",
        onInviteRefresh,
      );
    };
  }, [slug, chat.phase]);

  return {
    project,
    chatHistory,
    chat,
    chatStream,
    send,
    refresh,
    onVisualNoOp,
    visualNoOpBannerForFrame,
  };
}
