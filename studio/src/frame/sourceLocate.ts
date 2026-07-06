/**
 * Source-map coordinate translation for the in-iframe picker.
 *
 * WHY THIS EXISTS
 *   Studio serves each frame's `index.tsx` through Vite/esbuild, which
 *   pretty-prints and expands JSX into `jsxDEV(...)` calls. A 262-line source
 *   becomes a ~2500-line served module. React 19's `_debugStack` reports click
 *   locations in the SERVED module's coordinates, but every downstream consumer
 *   — the deterministic `locateJsx` writer AND the chat preamble handed to the
 *   agent — operates on the ON-DISK source. Feeding transformed line numbers to
 *   either produces a guaranteed miss (e.g. "edit line 2295" on a 262-line
 *   file), so edits silently bailed to a full-file rewrite.
 *
 *   Vite already serves a standard v3 source map at `<moduleUrl>.map`. This
 *   module fetches + decodes it and maps generated line:column back to the true
 *   source line:column, so the picker can post SOURCE coordinates. Both editing
 *   lanes then work unchanged.
 *
 *   Self-contained VLQ decoder (no new dependency): the mapping we need — a
 *   single generated position → source position lookup — is a few lines, and
 *   `@jridgewell/trace-mapping` isn't a direct dependency of this repo (adding
 *   one risks the transitive-dep trap that white-screened a prior release).
 */

/** 1-based source position; `line`/`column` are 1-based to match the picker's
 *  V8-stack convention and TypeScript's `locateJsx` (which subtracts 1). */
export interface SourcePos {
  line: number;
  column: number;
}

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CHAR_TO_INT: Record<string, number> = {};
for (let i = 0; i < BASE64.length; i++) CHAR_TO_INT[BASE64[i]] = i;

/**
 * Decode one line's worth of base64-VLQ segments starting at `pos`. Returns the
 * decoded integers and the index just past the consumed characters. VLQ: each
 * value is a series of base64 digits; the lowest bit of the first digit is the
 * sign, bit 5 (0x20) is the continuation flag.
 */
function decodeVlqSegment(str: string, pos: number): { values: number[]; next: number } {
  const values: number[] = [];
  let shift = 0;
  let value = 0;
  let i = pos;
  for (; i < str.length; i++) {
    const c = str[i];
    if (c === "," || c === ";") break;
    const digit = CHAR_TO_INT[c];
    if (digit === undefined) break;
    const cont = digit & 0x20;
    const rest = digit & 0x1f;
    value += rest << shift;
    if (cont) {
      shift += 5;
    } else {
      const negative = value & 1;
      value >>= 1;
      values.push(negative ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return { values, next: i };
}

/** A single mapping: generated column → source line/column (all 0-based, as the
 *  map stores them). Only segments with a source reference are kept. */
interface Segment {
  genColumn: number;
  srcLine: number;
  srcColumn: number;
}

/**
 * Parse a v3 `mappings` string into a per-generated-line array of segments.
 * Index `i` holds the segments for generated line `i` (0-based). Fields are
 * delta-encoded: srcLine/srcColumn accumulate across the WHOLE file, genColumn
 * resets to 0 at each new generated line (";").
 */
export function parseMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let current: Segment[] = [];
  let genColumn = 0;
  let srcLine = 0;
  let srcColumn = 0;
  let i = 0;
  while (i < mappings.length) {
    const c = mappings[i];
    if (c === ";") {
      lines.push(current);
      current = [];
      genColumn = 0; // generated column resets per line
      i++;
      continue;
    }
    if (c === ",") {
      i++;
      continue;
    }
    const { values, next } = decodeVlqSegment(mappings, i);
    i = next;
    if (values.length === 0) continue;
    genColumn += values[0];
    // A segment with only a generated column has no source mapping — skip it.
    if (values.length >= 4) {
      srcLine += values[2];
      srcColumn += values[3];
      current.push({ genColumn, srcLine, srcColumn });
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Given parsed mappings, find the source position for a generated line:column
 * (both 1-based). Picks the segment on that generated line with the greatest
 * genColumn ≤ the target column (the mapping that "covers" the position). If
 * the exact line has no segments, walks upward to the nearest preceding line
 * that does — expanded JSX often maps a whole element to one source line, and
 * inner generated lines carry no fresh source anchor. Returns null when nothing
 * maps (caller keeps the original transformed coords as a last resort).
 */
export function originalPositionFor(
  perLine: Segment[][],
  genLine: number,
  genColumn: number,
): SourcePos | null {
  const line0 = genLine - 1;
  const col0 = genColumn - 1;
  for (let l = line0; l >= 0; l--) {
    const segs = perLine[l];
    if (!segs || segs.length === 0) continue;
    // On the exact clicked line, honor the column; on a fallback (earlier) line,
    // take its last segment (closest to the click).
    let chosen: Segment | null = null;
    if (l === line0) {
      for (const s of segs) {
        if (s.genColumn <= col0) chosen = s;
        else break;
      }
      // Column is before the first segment on this line — fall through to the
      // line's first segment rather than skipping to a previous line.
      if (!chosen) chosen = segs[0];
    } else {
      chosen = segs[segs.length - 1];
    }
    if (chosen) return { line: chosen.srcLine + 1, column: chosen.srcColumn + 1 };
  }
  return null;
}

// Per-module-URL cache of parsed mappings. Modules are versioned by Vite's
// query string, so the URL is a stable key for the life of a page.
const mapCache = new Map<string, Promise<Segment[][] | null>>();

/**
 * Build the source-map URL for a served module URL. Vite serves the map at
 * `<pathname>.map`, and `.map` MUST go BEFORE the query string — appending it
 * after the query (`index.tsx?t=123.map`) 500s, while `index.tsx.map?t=123`
 * resolves. The query (Vite's `?t=`/`?v=` version token) is preserved so the
 * map matches the exact served module revision. Exported for unit testing.
 */
export function mapUrlFor(moduleUrl: string): string {
  try {
    const u = new URL(moduleUrl, "http://frame.local");
    u.pathname = `${u.pathname}.map`;
    // Reconstruct without the synthetic base when the input was relative.
    return /^[a-z]+:\/\//i.test(moduleUrl) ? u.href : `${u.pathname}${u.search}`;
  } catch {
    // Fallback: split on the first "?" and insert ".map" before it.
    const qIdx = moduleUrl.indexOf("?");
    return qIdx === -1
      ? `${moduleUrl}.map`
      : `${moduleUrl.slice(0, qIdx)}.map${moduleUrl.slice(qIdx)}`;
  }
}

/**
 * Fetch + parse the source map for a served module URL (the `.map` sibling Vite
 * serves). Cached per URL. Returns null on any failure — the caller then keeps
 * the transformed coordinates, which is no worse than before this module.
 */
async function loadMappings(moduleUrl: string): Promise<Segment[][] | null> {
  const cached = mapCache.get(moduleUrl);
  if (cached) return cached;
  const p = (async () => {
    try {
      const res = await fetch(mapUrlFor(moduleUrl));
      if (!res.ok) return null;
      const json = (await res.json()) as { mappings?: string; version?: number };
      if (!json || typeof json.mappings !== "string") return null;
      return parseMappings(json.mappings);
    } catch {
      return null;
    }
  })();
  mapCache.set(moduleUrl, p);
  return p;
}

/**
 * Translate a generated line:column in a served module back to the on-disk
 * source line:column. `moduleUrl` is the full served URL (origin + path +
 * query) taken from the `_debugStack` frame. On any failure, returns the input
 * coordinates unchanged so the picker still posts something usable.
 */
export async function toSourcePosition(
  moduleUrl: string,
  genLine: number,
  genColumn: number,
): Promise<SourcePos> {
  const perLine = await loadMappings(moduleUrl);
  if (!perLine) return { line: genLine, column: genColumn };
  const mapped = originalPositionFor(perLine, genLine, genColumn);
  return mapped ?? { line: genLine, column: genColumn };
}
