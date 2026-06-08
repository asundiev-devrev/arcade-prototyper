import type { TelemetryEvent } from "./events";
import { debugTrack, debugError, type ProcessTag } from "./debugSink";

/** Pluggable send target. server.ts/renderer.ts build this from their SDKs. */
export interface SendAdapter {
  capture(eventName: string, distinctId: string, props: Record<string, unknown>): void;
  captureException(err: unknown): void;
}

interface CoreState {
  proc: ProcessTag;
  enabled: boolean;
  debug: boolean;
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
  adapter: SendAdapter | null;
}

let state: CoreState | null = null;

export function initCore(args: CoreState): void {
  state = { ...args };
}

function superProps() {
  return {
    distinct_id: state!.distinctId,
    session_id: state!.sessionId,
    version: state!.version,
    os: state!.os,
    process: state!.proc,
  };
}

export function track(event: TelemetryEvent): void {
  if (!state) return; // not initialized → no-op
  const props = { ...event.props, ...superProps() };
  if (state.enabled && state.adapter) {
    try { state.adapter.capture(event.name, state.distinctId, props); }
    catch (err) { console.warn("[telemetry] capture failed:", err instanceof Error ? err.message : err); }
    return;
  }
  if (state.debug) debugTrack(state.proc, { name: event.name, props }, state.distinctId);
}

export function captureError(err: unknown): void {
  if (!state) return;
  if (state.enabled && state.adapter) {
    try { state.adapter.captureException(err); } catch {}
    return;
  }
  if (state.debug) debugError(state.proc, err);
}

/** Test-only: clears module state between tests. */
export function __resetForTest(): void { state = null; }
