import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, ChatMessage } from "../../server/types";
import { useChatStream, type StreamState } from "./useChatStream";
import {
  firstSummaryLine,
  shouldTriggerVisualNoOpRetry,
} from "../components/viewport/visualNoOp";
import { narrationClaimsVisualChange } from "../../server/visualNoOpRetry";
import {
  extractRequestedProperties,
  reconcile,
  RENDER_VERIFY_RETRY_PROMPT,
} from "../../server/renderVerify";
// BOTH from the browser-safe client module (zero node imports). Do NOT import
// the prompt from server/renderVerifyIsolation — that module transitively pulls
// esbuild + a native tailwind .node addon and white-screens the shell (Vite dev
// serves untree-shaken). The server route is unchanged; the client sends this
// const as the corrective's POST body prompt.
import { verifyRenderNoOp, RENDER_VERIFY_CORRECTIVE_PROMPT } from "../lib/renderVerifyClient";
import { shouldRunRenderVerify } from "./renderVerifyGate";
import type { RenderDigest } from "../frame/frameDigest";

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
  /** Buffer a frame's render digest (called by FrameCard via the Viewport
   *  prop-thread). Turn-persistent — the mount-time digest is the only one on a
   *  no-edit turn, so render-verify keeps it across turns. */
  onRenderDigest: (frameSlug: string, digest: RenderDigest) => void;
  /** Set to a frame slug when the user asked for a visual property (e.g.
   *  vertical) that the render still contradicts AFTER one corrective retry.
   *  Drives the soft RenderMismatchBanner. Cleared on the next user send. */
  renderMismatchBannerForFrame: string | null;
}

export interface PerTurnRefs {
  noOpCandidate: { current: string | null };
  handledTurn: { current: string | null };
  digestByFrame: { current: Map<string, unknown> };
}
/** Clear per-turn state at a new USER turn. Deliberately does NOT touch
 *  digestByFrame — render-verify needs the mount-time digest on a no-edit turn,
 *  which never re-pushes. This omission is the feature's crux. */
export function resetPerTurn(refs: PerTurnRefs, clearBanners: () => void): void {
  refs.noOpCandidate.current = null;
  refs.handledTurn.current = null;
  clearBanners();
  // digestByFrame intentionally NOT reset.
}

/**
 * Master switch for the two RENDER-MEASUREMENT features — visual-noop detection
 * and render-verify. Both compare a fingerprint/digest of the frame's rendered
 * `document.body` before vs after a turn.
 *
 * DISABLED (2026-07-20) after a live manual gate proved the measurement premise
 * is broken for the common case: arcade frames are client-routed MULTI-PAGE
 * apps (a sidebar + `renderPage(active)` that mounts only the active page). The
 * measurement runs at iframe mount, when the DEFAULT page is showing — so it
 * measures the wrong page and returns a CONSTANT fingerprint across every edit
 * (proven: fp `d8b977cd` on every render; the edited Preferences page + its
 * vertical ToggleGroups never appear in the measured DOM — `hasTimezoneText=-1`,
 * only 6 unrelated horizontal carriers from the default MyComputer page). That
 * made both features FALSE-FIRE "nothing changed" on real edits and churn good
 * work into nonsense (ToggleGroup→ButtonGroup), plus leak the internal
 * corrective prompt into the chat as a fake user bubble.
 *
 * Correctly measuring the edited page in a multi-page frame (detect the page,
 * drive the router to it, measure before+after) is the real render-verify
 * KEYSTONE — a large, fragile lift, out of scope for this release. The other
 * five edit-reliability features do NOT depend on measurement and ship.
 *
 * Code kept behind this flag (not deleted) so the keystone effort resumes with
 * full context. Flip true only once measurement is page-aware. See
 * docs/superpowers/specs/2026-07-20-edit-reliability-render-verify-rendered-fact-design.md.
 */
const RENDER_MEASUREMENT_FEATURES_ENABLED = false;

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

  // ── Render-verify (the user asked for a visual property the render contradicts) ──
  // PARALLEL path to VN: own digest store, own corrective flag, own banner,
  // own turn-end effect (declared AFTER VN's). The ONLY shared state is VN's
  // existing `handledTurn` ref (the one-corrective-per-turn guard). VN's effect
  // runs first (declared first) → if VN fires it claims `handledTurn` and RV
  // skips the turn (edit-noop priority).
  //
  // digestByFrame is TURN-PERSISTENT — NEVER cleared on a turn/frame transition.
  // The mount-time digest is the only one on a no-edit turn; clearing it would
  // leave the no-edit repro nothing to compare and self-defeat the feature.
  const digestByFrame = useRef<Map<string, RenderDigest>>(new Map());
  // The USER'S originating prompt for the current turn, captured at turn start
  // (never the corrective-overwritten `lastPrompt`).
  const originating = useRef<{ prompt: string; turnId: string } | null>(null);
  // RV's OWN corrective flag — NOT VN's `awaitingCorrective`.
  const awaitingRvCorrective = useRef(false);
  const rvPendingFrame = useRef<string | null>(null);
  const [renderMismatchBannerForFrame, setRenderMismatchBannerForFrame] =
    useState<string | null>(null);

  const onRenderDigest = useCallback((frameSlug: string, digest: RenderDigest) => {
    digestByFrame.current.set(frameSlug, digest);
  }, []);

  // ── Render-verify v3 (isolation before/after) — a NEW, separate path ────────
  // Independent of the DISABLED v1/v2 effects above (which stay gated behind
  // RENDER_MEASUREMENT_FEATURES_ENABLED). v3 renders the edited page in
  // ISOLATION (server-bundled), before vs after, and fingerprints each in a
  // hidden iframe — no live multi-page router in the loop (the trap that killed
  // v1/v2). Fully separate state from VN's: its own one-shot, corrective flag,
  // and target refs.
  //
  // The turnId we last acted on for v3 (POSTed a corrective for, or classified
  // as the v3 corrective turn) — the per-turn one-shot guard.
  const rvV3Handled = useRef<string | null>(null);
  // TRUE while we're awaiting the v3 corrective turn's `done` (its end is
  // re-verified ONCE then banner-only — never a second corrective → no loop).
  const awaitingRvV3 = useRef(false);
  // The frame + target page to re-verify (and banner) when the v3 corrective ends.
  const rvV3Frame = useRef<string | null>(null);
  const rvV3TargetPage = useRef<string | null>(null);
  // Live mirror of chat.turnId, updated at the top of the v3 effect on EVERY
  // turnId change (before the phase guard). The async verify takes ~1.2s; the
  // effect closure's `turnId` is a render-time snapshot that never mutates, so
  // this ref is how the post-await guard actually detects a superseding turn.
  const rvV3LiveTurnId = useRef<string | null>(null);

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
    if (awaitingCorrective.current) return; // this new turn IS the VN corrective — keep state
    if (awaitingRvCorrective.current) return; // this new turn IS the RV corrective — keep state
    if (awaitingRvV3.current) return; // this new turn IS the RV3 corrective — keep state
    // A fresh user turn — clear any stale candidate/banner/one-shot. The pure
    // `resetPerTurn` helper clears the per-turn refs + banners but deliberately
    // LEAVES digestByFrame (the mount-time digest must survive — the crux).
    resetPerTurn(
      { noOpCandidate, handledTurn, digestByFrame },
      () => {
        setVisualNoOpBannerForFrame(null);
        setRenderMismatchBannerForFrame(null);
      },
    );
    // Reset RV3's own per-turn state on a fresh user turn (guarded above so a
    // v3 corrective turn does NOT reset them — that turn must keep rvV3Frame /
    // rvV3TargetPage / rvV3Handled so its end can re-verify + banner).
    rvV3Handled.current = null;
    awaitingRvV3.current = false;
    rvV3Frame.current = null;
    rvV3TargetPage.current = null;
    // Capture the USER'S originating prompt BEFORE any corrective overwrites
    // `lastPrompt` (the corrective turn's SSE header rewrites it). turnId +
    // lastPrompt are set atomically by the turn header (useChatStream.ts:199-212).
    originating.current = { prompt: chat.lastPrompt ?? "", turnId };
  }, [chat.turnId]);

  // Nicety wrapper (used by a few non-composer send paths); the reset above is
  // the load-bearing one, so this only needs to forward.
  const send = rawSend;

  // On a clean turn end: if this is the CORRECTIVE turn → banner-only (never
  // re-POST). Otherwise, if a no-op candidate is buffered AND the agent's
  // summary claimed a visual change → POST the corrective retry + reconnect.
  useEffect(() => {
    if (!RENDER_MEASUREMENT_FEATURES_ENABLED) return; // DISABLED — see the flag comment above
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

  // Render-verify turn-end effect — declared AFTER VN's (so VN runs first →
  // priority via the shared `handledTurn` guard). On a clean turn end:
  //   - if this IS the RV corrective turn → banner-only (never re-POST); if the
  //     buffered digest still contradicts, surface the RV banner;
  //   - else, if VN didn't claim the turn AND the USER'S originating prompt
  //     requested a visual property the buffered digest UNANIMOUSLY contradicts
  //     → POST the RV corrective + reconnect.
  useEffect(() => {
    if (!RENDER_MEASUREMENT_FEATURES_ENABLED) return; // DISABLED — see the flag comment above
    if (chat.phase !== "done") return;
    const turnId = chat.turnId;
    if (!turnId) return;

    // The RV corrective turn ended → banner-only, never re-POST.
    if (awaitingRvCorrective.current) {
      awaitingRvCorrective.current = false;
      // Claim this corrective turn in the SHARED guard so VN's effect (declared
      // first) doesn't treat it as an un-handled turn and pile a SECOND
      // corrective on it (RV corrective → also a visual-noop with a
      // visual-claiming summary → VN would otherwise fire). Mirrors VN's own
      // banner-only branch, which claims handledTurn for the same reason.
      handledTurn.current = turnId;
      const target = rvPendingFrame.current;
      rvPendingFrame.current = null;
      if (target && originating.current) {
        const requested = extractRequestedProperties(originating.current.prompt);
        const digest = digestByFrame.current.get(target);
        if (requested.length > 0 && digest && reconcile(requested, digest).length > 0) {
          setRenderMismatchBannerForFrame(target); // corrective didn't fix it
        }
      }
      return;
    }

    // Shared one-fire guard: VN's effect (declared first) sets handledTurn when
    // it fires → RV skips this turn. If VN didn't claim the turn, RV may.
    if (handledTurn.current === turnId) return;
    if (!originating.current || originating.current.turnId !== turnId) return;

    const requested = extractRequestedProperties(originating.current.prompt);
    if (requested.length === 0) return;

    // v1 target-frame resolution: first frame whose digest unanimously contradicts.
    let target: string | null = null;
    let mismatchPrompt = "";
    for (const [frameSlug, digest] of digestByFrame.current) {
      const mismatches = reconcile(requested, digest);
      if (mismatches.length > 0) {
        target = frameSlug;
        mismatchPrompt = RENDER_VERIFY_RETRY_PROMPT(mismatches[0]);
        break;
      }
    }
    if (!target) return;

    handledTurn.current = turnId; // claim the turn (blocks a late VN fire too)
    awaitingRvCorrective.current = true;
    rvPendingFrame.current = target;
    const userTurnId = originating.current.turnId;
    let cancelled = false;
    void (async () => {
      try {
        await fetch("/api/chat/render-verify-retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, frame: target, userTurnId, prompt: mismatchPrompt }),
        });
        if (cancelled) return;
        chatStream.reconnect();
      } catch {
        awaitingRvCorrective.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.phase, chat.turnId, slug]);

  // ── Render-verify v3 turn-end effect (isolation before/after) ───────────────
  // A NEW, separate path — NOT gated by RENDER_MEASUREMENT_FEATURES_ENABLED (the
  // disabled v1/v2 flag). On an EDIT turn that claimed a visual change, fetch the
  // turn meta, isolation-render the edited page before vs after, and on a
  // confirmed no-op fire ONE render-gated corrective (the EXISTING v2 route,
  // v3 corrective prompt in the body). The corrective turn's end is re-verified
  // ONCE → still no-op → honest banner. One corrective per user turn (hard stop).
  useEffect(() => {
    // Keep the live-turnId mirror current on EVERY turnId change (before any
    // phase guard) — this is what the post-await guard reads to detect a turn
    // that superseded the one we started verifying.
    rvV3LiveTurnId.current = chat.turnId;

    // The corrective turn reached a TERMINAL phase. Clear awaitingRvV3 + the
    // frame/page refs SYNCHRONOUSLY on ANY terminal end (done/error/cancelled) —
    // NOT just "done". If the corrective ERRORS (Bedrock throttle/auth lapse)
    // and we only cleared on "done", awaitingRvV3 would stay set → the reset
    // effect's `if (awaitingRvV3.current) return` skips the next user turn's
    // reset → RV3 stuck + a stale banner mis-fires on an unrelated frame.
    // Re-verify (→ banner) only on a clean "done"; on error/cancelled just clear.
    if (awaitingRvV3.current && (chat.phase === "done" || chat.phase === "error" || chat.phase === "cancelled")) {
      const frame = rvV3Frame.current;
      const targetPage = rvV3TargetPage.current;
      const wasClean = chat.phase === "done";
      const cTurnId = chat.turnId;
      awaitingRvV3.current = false;
      rvV3Frame.current = null;
      rvV3TargetPage.current = null;
      if (!wasClean || !frame || !targetPage || !cTurnId) return; // errored/cancelled → cleared, no banner
      let cCancelled = false;
      void (async () => {
        const outcome = await verifyRenderNoOp(slug, frame, targetPage);
        // Async guard: a new user turn may have landed during the ~1.2s verify.
        // Bail if this effect was torn down (cCancelled) OR chat.turnId advanced
        // past the corrective turn we were re-verifying (superseded) — never
        // banner a stale frame for a turn the user has moved past.
        if (cCancelled || rvV3LiveTurnId.current !== cTurnId) return;
        // [RV3-DIAG] post-corrective re-verify verdict — "no-op" here = the
        // yellow banner fires. If the corrective DID fix the render, a "no-op"
        // verdict is the FALSE banner we're hunting.
        console.log(`[RV3-DIAG] corrective-end re-verify frame=${frame} → ${outcome} (no-op ⇒ banner)`);
        if (outcome === "no-op") setRenderMismatchBannerForFrame(frame);
      })();
      return () => {
        cCancelled = true;
      };
    }

    // Fire path — only on a clean user-turn end.
    if (chat.phase !== "done") return;
    const turnId = chat.turnId;
    if (!turnId) return;
    let cancelled = false;

    // Not the corrective turn → maybe fire v3 on this user turn. Fetch the
    // post-turn meta the server published (turnType + edited frame + page).
    void (async () => {
      let meta: { turnType?: string; frame?: string | null; targetPage?: string | null };
      try {
        const res = await fetch(`/api/chat/last-turn-meta/${slug}`);
        if (!res.ok) return; // fail open
        meta = await res.json();
      } catch {
        return; // fail open
      }
      // Async guard #1: bail if torn down OR the turn advanced while fetching.
      if (cancelled || rvV3LiveTurnId.current !== turnId) return;

      const frame = meta.frame ?? null;
      const targetPage = meta.targetPage ?? null;
      const isEditTurn = meta.turnType === "edit" && !!frame && !!targetPage;
      const summaryClaimsChange = narrationClaimsVisualChange(
        firstSummaryLine(chat.narrations),
      );
      if (
        !shouldRunRenderVerify({
          phase: chat.phase,
          isEditTurn,
          summaryClaimsChange,
          alreadyRan: rvV3Handled.current === turnId,
        })
      ) {
        return;
      }
      // Narrow for TS (isEditTurn already guarantees these are non-null).
      if (!frame || !targetPage) return;

      const outcome = await verifyRenderNoOp(slug, frame, targetPage);
      // Async guard #2 — THE async-in-effect guard (write it explicitly, not
      // just "mirror"): after the ~1.2s verify, bail if this effect was torn
      // down (cancelled) OR a new user turn landed (chat.turnId advanced past
      // the turn we verified) — a corrective for a superseded turn is wrong.
      if (cancelled || rvV3LiveTurnId.current !== turnId) return;
      // [RV3-DIAG] initial fire decision. "no-op" here fires the corrective. On
      // a turn where the agent's FIRST reply already made a real visible change,
      // a "no-op" verdict is the spurious fire that caused the churn.
      console.log(`[RV3-DIAG] initial verify frame=${frame} → ${outcome} (no-op ⇒ fires corrective)`);
      if (outcome !== "no-op") return; // "changed"/"skip" → silent (fail open)

      // Confirmed no-op → claim the turn, fire ONE corrective via the EXISTING
      // v2 route (v3 corrective prompt in the body), then reconnect to stream
      // the corrective turn.
      rvV3Handled.current = turnId;
      awaitingRvV3.current = true;
      rvV3Frame.current = frame;
      rvV3TargetPage.current = targetPage;
      try {
        await fetch("/api/chat/render-verify-retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            frame,
            userTurnId: turnId,
            prompt: RENDER_VERIFY_CORRECTIVE_PROMPT,
          }),
        });
        if (cancelled) return;
        chatStream.reconnect();
      } catch {
        awaitingRvV3.current = false; // POST failed → no corrective this turn
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
    onRenderDigest,
    renderMismatchBannerForFrame,
  };
}
