import { createHash } from "node:crypto";

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

/** Remove absolute arcade-studio project paths, leaving the readable error. */
export function stripPaths(s: string): string {
  return s
    .replace(/\/[^\s]*arcade-studio\/projects\/[^\s]*/g, "<frame-path>")
    .replace(/\/Users\/[^\s/]+/g, "<home>");
}

/** Sentry beforeSend: scrub auth headers + prompt-bearing extras. */
export function sentryBeforeSend<T extends Record<string, any>>(event: T): T {
  const headers = event?.request?.headers;
  if (headers && typeof headers === "object") {
    for (const key of Object.keys(headers)) {
      if (/^authorization$/i.test(key)) headers[key] = "[redacted]";
    }
  }
  if (event?.extra && typeof event.extra === "object" && "prompt" in event.extra) {
    event.extra.prompt = "[redacted]";
  }
  return event;
}
