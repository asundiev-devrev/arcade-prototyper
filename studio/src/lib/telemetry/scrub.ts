/**
 * Crypto-free scrubbers shared by the server + renderer Sentry pipelines.
 * Kept separate from redact.ts (which imports node:crypto for hashSlug) so the
 * browser bundle can import this without pulling node:crypto in.
 *
 * electron/telemetry.ts cannot import across its compile boundary, so it keeps a
 * hand-mirrored copy of scrubSentryEvent — keep the two in lockstep.
 */

/** Remove absolute arcade-studio project paths + user home dirs, leaving the readable text. */
export function stripPaths(s: string): string {
  return s
    .replace(/\/[^\s]*arcade-studio\/projects\/[^\s]*/g, "<frame-path>")
    .replace(/\/Users\/[^\s/]+/g, "<home>");
}

/**
 * Replace token-shaped substrings so a leaked credential never rides along in a
 * Sentry message/stack. Conservative denylist — a false positive just over-redacts.
 */
export function stripTokens(s: string): string {
  return s
    .replace(/\bBearer\s+[\w.\-]+/gi, "Bearer <token>")
    .replace(/\bgh[posru]_[A-Za-z0-9]{20,}\b/g, "<gh-token>")
    .replace(/\bsk-[A-Za-z0-9]{16,}\b/g, "<token>")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "<aws-key>")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<jwt>");
}

/** Full text scrub: home paths + token-shaped strings. */
export function scrubText(s: string): string {
  return stripTokens(stripPaths(s));
}

/**
 * Scrub a Sentry event in place before send: error message, exception values +
 * stack-frame file paths, breadcrumb URLs/messages, auth headers, and the prompt
 * extra. Tolerates shape surprises (swallows errors). Shared by server (node) and
 * renderer (browser); mirrored in electron/telemetry.ts.
 */
export function scrubSentryEvent<T extends Record<string, any>>(event: T): T {
  const e: any = event;
  try {
    if (typeof e?.message === "string") e.message = scrubText(e.message);

    const values = e?.exception?.values;
    if (Array.isArray(values)) {
      for (const v of values) {
        if (typeof v?.value === "string") v.value = scrubText(v.value);
        const frames = v?.stacktrace?.frames;
        if (Array.isArray(frames)) {
          for (const f of frames) {
            if (typeof f?.filename === "string") f.filename = stripPaths(f.filename);
            if (typeof f?.abs_path === "string") f.abs_path = stripPaths(f.abs_path);
          }
        }
      }
    }

    if (Array.isArray(e?.breadcrumbs)) {
      for (const b of e.breadcrumbs) {
        if (typeof b?.data?.url === "string") {
          b.data.url = b.data.url.replace(/\/api\/projects\/[^/]+/g, "/api/projects/<slug>");
        }
        if (typeof b?.message === "string") b.message = scrubText(b.message);
      }
    }

    const headers = e?.request?.headers;
    if (headers && typeof headers === "object") {
      for (const k of Object.keys(headers)) if (/^authorization$/i.test(k)) headers[k] = "[redacted]";
    }

    if (e?.extra && typeof e.extra === "object" && "prompt" in e.extra) {
      e.extra.prompt = "[redacted]";
    }
  } catch {
    // never let scrubbing throw inside beforeSend
  }
  return event;
}
