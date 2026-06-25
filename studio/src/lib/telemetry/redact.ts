import { createHash } from "node:crypto";

// stripPaths lives in the crypto-free scrub.ts so the browser bundle can use it;
// re-exported here for existing importers (runtimeError.ts, chat.ts).
export { stripPaths } from "./scrub";
import { scrubSentryEvent } from "./scrub";

/** sha1 of input, first 12 hex chars. Stable, non-reversible for our purposes.
 *  Used for project slugs + frame paths so we can correlate events for the same
 *  project without leaking its name. */
export function hashSlug(slug: string): string {
  return createHash("sha1").update(slug).digest("hex").slice(0, 12);
}

/** Truncate to `max` chars, appending a single ellipsis char when cut. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

/** Sentry beforeSend: scrub message/stack/breadcrumbs/headers/prompt + token-shaped strings. */
export function sentryBeforeSend<T extends Record<string, any>>(event: T): T {
  return scrubSentryEvent(event);
}
