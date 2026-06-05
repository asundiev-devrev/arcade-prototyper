import path from "node:path";

/**
 * Resolve a safe on-disk file extension for an upload.
 *
 * Uploads are saved under a server-generated random base name
 * (`<timestamp>-<rand>.<ext>`); only the *extension* is derived from
 * caller-supplied data, and never the filename itself — so a malicious
 * `../../etc/passwd` filename cannot influence the write path.
 *
 * Preference order:
 *   1. The extension of the original filename (when the client sends one via
 *      the `X-Upload-Filename` header). This is what lets a `.pdf` / `.docx`
 *      / `.md` round-trip with the right extension, which the agent relies on
 *      to know what kind of file it's reading.
 *   2. The MIME subtype (e.g. `application/pdf` → `pdf`), as a fallback when
 *      no filename is available (clipboard pastes often have none).
 *   3. `bin` as a last resort.
 *
 * The result is always lowercased and reduced to `[a-z0-9]` so it can't carry
 * path separators, dots, or other characters that would break the write path
 * or the downstream `@<path>` prompt reference.
 */
export function resolveUploadExtension(
  filename: string | undefined,
  contentType: string | undefined,
): string {
  const fromName = sanitizeExt(path.extname(filename ?? "").slice(1));
  if (fromName) return fromName;

  const subtype = (contentType ?? "").split(";")[0].trim().toLowerCase().split("/")[1] ?? "";
  // `image/svg+xml` is the one common type whose subtype isn't its extension.
  if (subtype === "svg+xml") return "svg";
  // `application/vnd.openxmlformats-…` and similar verbose subtypes sanitize
  // to long noise; the filename path above covers the real-world docx/xlsx
  // cases, so a generic fallback here is fine.
  const fromType = sanitizeExt(subtype);
  if (fromType && fromType.length <= 5) return fromType;

  return "bin";
}

function sanitizeExt(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
}

/** Decode an `X-Upload-Filename` header value (the client encodeURIComponent's
 *  it so non-ASCII names survive the HTTP header round-trip). */
export function decodeUploadFilename(headerValue: string | string[] | undefined): string | undefined {
  if (!headerValue) return undefined;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
