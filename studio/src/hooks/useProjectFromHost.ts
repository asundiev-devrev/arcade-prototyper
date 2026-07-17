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
  // One-shot keyed on the ORIGINATING user turn id — survives the corrective
  // turn's own `end` (which carries a different turn id) so we never loop.
  const triggeredForTurn = useRef<string | null>(null);
  // The turn id the corrective retry runs under (from the POST's 202 body) —
  // never trigger a retry for it; its `done` only drives the banner.
  const correctiveTurnId = useRef<string | null>(null);
  const [visualNoOpBannerForFrame, setVisualNoOpBannerForFrame] = useState<string | null>(null);

  const onVisualNoOp = useCallback((frameSlug: string) => {
    noOpCandidate.current = frameSlug;
  }, []);

  // Wrap send so a NEW user turn resets the one-shot + clears any stale banner.
  const send = useCallback(
    (prompt: string, images?: string[]) => {
      triggeredForTurn.current = null;
      correctiveTurnId.current = null;
      noOpCandidate.current = null;
      setVisualNoOpBannerForFrame(null);
      rawSend(prompt, images);
    },
    [rawSend],
  );

  // On a clean turn end: if a no-op candidate is buffered AND the agent's
  // summary claimed a visual change AND this is a not-yet-handled USER turn →
  // POST the corrective retry and reconnect the stream. If instead this is the
  // CORRECTIVE turn ending still-no-op → show the banner (no second retry).
  useEffect(() => {
    if (chat.phase !== "done") return;
    const turnId = chat.turnId;
    if (!turnId) return;

    // The corrective turn ended. If it ALSO produced a no-op candidate, the
    // retry didn't move pixels → surface the honest banner. Never re-POST.
    if (turnId === correctiveTurnId.current) {
      if (noOpCandidate.current) {
        setVisualNoOpBannerForFrame(noOpCandidate.current);
      }
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
        alreadyTriggeredThisTurn: triggeredForTurn.current === turnId,
      })
    ) {
      return;
    }
    triggeredForTurn.current = turnId;
    // Clear the candidate so a fresh onVisualNoOp during the corrective turn is
    // distinguishable (a re-noop → banner).
    noOpCandidate.current = null;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/chat/visual-noop-retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, frame: candidate, userTurnId: turnId }),
        });
        if (cancelled) return;
        const data = (await res.json().catch(() => null)) as { turnId?: string } | null;
        if (data?.turnId) correctiveTurnId.current = data.turnId;
        chatStream.reconnect();
      } catch {
        // Best-effort — a failed retry just means no auto-correction this turn.
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
