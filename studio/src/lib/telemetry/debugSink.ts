import type { TelemetryEvent } from "./events";

export type ProcessTag = "main" | "renderer" | "server";

export function debugTrack(proc: ProcessTag, event: TelemetryEvent, distinctId: string): void {
  console.log(`[telemetry:${proc}] ${event.name}`, { ...event.props, distinct_id: distinctId });
}

export function debugError(proc: ProcessTag, err: unknown): void {
  console.error(`[telemetry:${proc}] error`, err);
}
