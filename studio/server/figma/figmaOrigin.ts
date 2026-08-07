/**
 * The per-frame record of WHICH FIGMA NODE a frame was imported from.
 *
 * Written by the deterministic importer at import time, read by
 * `server/figma/adapters/studioFrameReader.ts` so provenance can scope a node
 * match to a Figma FILE. One filename constant and one shape, in one place, so the
 * writer and the reader cannot drift — the same discipline `frameSlug.ts` exists
 * for.
 *
 * WHY THIS FILE EXISTS AT ALL. Provenance needs the file key because Figma node
 * ids are only unique WITHIN a file, and multi-file projects are real
 * (`polina-s-prototype` on disk references two). The first implementation
 * recovered the key by regexing the URL out of `LIFT.json#intentSummary`, which
 * looked verified and was not: `liftEmitPlugin.ts` sets `intentSummary` to the
 * PROJECT'S FIRST user message, so every frame in a project carried the key of
 * whatever was imported first. Verified on disk — all three frames of
 * `implement-this-precisely-3` have a byte-identical `intentSummary`. On a
 * multi-file project that both suppressed genuine hits on later-imported files
 * (the original duplicate-frame bug, in the one scenario file scoping exists for)
 * and accepted the colliding id it was built to reject.
 *
 * The lesson generalises past this feature: the importer KNOWS the key at write
 * time, so persist it there rather than reconstructing it later from a field that
 * means something else. A derived value that is right on the frames you happen to
 * check is indistinguishable from a correct one.
 *
 * Zero imports on purpose — a leaf both a Studio adapter and the importer can share
 * without either inheriting the other's closure. Added 2026-08-06 with the Figma
 * turn-routing cascade.
 */

/** Filename inside a frame directory. Dot-free so the frame enumerators see it,
 *  and `.json` so it is obviously data rather than something Vite should serve. */
export const FIGMA_ORIGIN_FILE = "figma-origin.json";

/** What we record. Deliberately minimal — only what provenance actually reads. */
export interface FigmaOrigin {
  /** The Figma file key (`/design/<key>/…`). The reason this record exists. */
  fileKey: string;
  /** The node the frame was imported from, colon form. Belt-and-braces: the slug
   *  usually encodes it, but a host or a designer may rename a frame. */
  nodeId: string;
}

export function serialiseFigmaOrigin(origin: FigmaOrigin): string {
  return JSON.stringify(origin, null, 2);
}
