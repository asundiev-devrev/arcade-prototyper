/**
 * Telemetry event catalog. ONE source of truth for event names + payload
 * shapes. Call sites import the typed `TelemetryEvent` union so a typo or a
 * wrong payload is a compile error, not a silent bad row in PostHog.
 *
 * Privacy: payloads carry hashes/lengths, never raw prompt text, file paths,
 * project names, or secrets. See redact.ts.
 */

export type GenerationErrorKind = "bedrock_auth" | "cli_crash" | "parser_error" | "timeout" | "other";
export type FrameErrorKind = "module_not_found" | "syntax_error" | "runtime_exception" | "hmr_failure";
export type ShareErrorKind = "auth" | "worker_5xx" | "bundle_error" | "network" | "other";

export type TelemetryEvent =
  // --- app lifecycle (main process) ---
  | { name: "app_launched"; props: { version: string; os: string; os_version: string; is_first_launch: boolean } }
  | { name: "app_shutdown"; props: { session_duration_ms: number } }
  // --- frame generation (vite child) ---
  | { name: "prompt_submitted"; props: { prompt_length: number; prompt_text: string; project_slug_hash: string; model?: string; frame_count_before: number } }
  | { name: "frame_generated"; props: { project_slug_hash: string; duration_ms?: number; model?: string; tokens_input?: number; tokens_output?: number; turn_type: "build" | "edit" | "none"; frame_lines?: number } }
  | { name: "generation_failed"; props: { project_slug_hash: string; duration_ms?: number; error_kind: GenerationErrorKind; model?: string } }
  | { name: "generation_cancelled"; props: { project_slug_hash: string; duration_ms?: number; model?: string } }
  // --- frame runtime error (vite child, off /api/runtime-error) ---
  | { name: "frame_runtime_error"; props: { project_slug_hash: string; error_kind: FrameErrorKind; error_message: string; frame_hash: string } }
  // --- share flow (renderer click + server outcome) ---
  | { name: "share_opened"; props: { frame_count: number } }
  | { name: "share_started"; props: { frame_count: number; project_slug_hash: string } }
  | { name: "share_succeeded"; props: { duration_ms: number; frame_count: number } }
  | { name: "share_failed"; props: { duration_ms: number; error_kind: ShareErrorKind } }
  | { name: "share_url_copied"; props: Record<string, never> }
  // --- figma export (renderer) ---
  | { name: "figma_export_run"; props: { outcome: "ok" | "no_bridge" | "error"; instance_count?: number; failure_count?: number } }
  // --- settings (renderer) ---
  | { name: "settings_opened"; props: { tab: string } }
  // --- updates (renderer): first launch after a silent auto-update ---
  | { name: "whats_new_shown"; props: { version: string } };

export type TelemetryEventName = TelemetryEvent["name"];

export const EVENT_NAMES = [
  "app_launched", "app_shutdown",
  "prompt_submitted", "frame_generated", "generation_failed", "generation_cancelled",
  "frame_runtime_error",
  "share_opened", "share_started", "share_succeeded", "share_failed", "share_url_copied",
  "figma_export_run",
  "settings_opened",
  "whats_new_shown",
] as const satisfies readonly TelemetryEventName[];
