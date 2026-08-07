/**
 * Studio's implementation of the `FrameSourceReader` seam.
 *
 * THE ONLY STUDIO FILESYSTEM PATH IN THE WHOLE FEATURE. Everything else in the
 * routing layer is brain (see server/figma/provenance.ts, turnConstraints.ts,
 * turnRouting.ts, turnDirectives.ts). Reading files IS host-specific, so it lives
 * behind a two-line interface: `() => Promise<FrameSource[]>`. A Claude Code /
 * Cursor / Computer host implements the same interface over files it already has
 * in context, with no Studio vocabulary in it and no adapter like this one.
 *
 * ALL *.tsx IN THE FRAME DIR, NOT JUST index.tsx. The wire branch writes the
 * overlay design as a sibling `Overlay.tsx` through the same stamping emitter
 * (chat.ts:1722 passes `entryFileName`), and 11 non-index `.tsx` files exist inside
 * live frame dirs today. An index-only reader would miss an overlay node entirely
 * and the turn would fall back to the importer — the original bug, on the branch
 * that most needs provenance because the designer is mid-iteration. Every file in
 * one frame dir is emitted with the same `slug` (the FRAME slug), so several files
 * collapse to ONE candidate rather than registering as `ambiguous` (provenance.ts
 * `settle` de-duplicates).
 *
 * BEST-EFFORT BY DESIGN. Provenance is an optimisation: a reader that throws, or
 * a frame whose files are unreadable, must degrade to "no signal" and let the turn
 * proceed, never fail it. So every read is individually caught and the reader as a
 * whole cannot reject.
 *
 * Built 2026-08-06 alongside the Figma turn-routing cascade.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../../paths";
import { slugMatchesNode } from "../frameSlug";
import type { FrameSource, FrameSourceReader } from "../provenance";

/**
 * Skip a pathological generated file rather than block the turn on it. Mirrors
 * provenance.ts's own MAX_SOURCE_BYTES, applied here so we never even read it.
 */
const MAX_FILE_BYTES = 1_000_000;

/**
 * Recover the Figma FILE key a frame was imported from.
 *
 * Node ids are only unique WITHIN a Figma file, and multi-file projects are real
 * (`polina-s-prototype` on disk references two files; the 13 Figma prompts in the
 * corpus span three). Without a file key, a colliding id from a DIFFERENT file
 * reads as an edit of the wrong frame — and the generator would edit it without
 * hesitating.
 *
 * The deterministic importer writes `LIFT.json` next to the frame's entry file,
 * and its `intentSummary` is the verbatim prompt that created the frame — which,
 * for an imported frame, contains the Figma URL. Verified on the live frame
 * `01-figma-5678-118876`: `intentSummary` is
 * `"Implement this precisely: https://www.figma.com/design/ssUerkBL5uOm7tNyHoZVtc/…"`.
 *
 * Returns `undefined` on anything unexpected, and that is a FEATURE: provenance
 * treats a missing key as "unknown", never as "mismatch", so a frame we cannot
 * attribute keeps today's behaviour rather than losing provenance altogether.
 */
async function readFileKey(projectSlug: string, frameSlug: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(frameDir(projectSlug, frameSlug), "LIFT.json"), "utf-8");
    const url = String(JSON.parse(raw)?.intentSummary ?? "");
    // Same shape parseFigmaUrl accepts; matched here rather than imported so this
    // adapter stays a leaf over the brain rather than a second consumer of it.
    return /figma\.com\/(?:design|file)\/([A-Za-z0-9]+)/.exec(url)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Bind the seam for one project.
 *
 * `frames` is the project's frame list as the caller already has it (project.json)
 * — we do NOT re-enumerate the frames dir, so a frame the project record does not
 * know about is invisible to provenance. That is the correct conservative choice:
 * the record is what the rest of the turn reasons about, and disagreeing with it
 * here would name a frame the agent's other context never mentions.
 */
export function makeStudioFrameReader(
  projectSlug: string,
  frames: { slug: string }[],
): FrameSourceReader {
  return async () => {
    const out: FrameSource[] = [];
    for (const frame of frames) {
      const slug = frame?.slug;
      if (typeof slug !== "string" || !slug) continue;
      let dir: string;
      try {
        dir = frameDir(projectSlug, slug);
      } catch {
        // frameDir validates the slug shape and throws on a bad one.
        continue;
      }
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }
      const tsx = entries.filter((n) => n.endsWith(".tsx"));
      if (!tsx.length) continue;

      // One LIFT.json read per FRAME, not per file.
      const fileKey = await readFileKey(projectSlug, slug);
      // The importer encodes the origin node in the slug (`01-figma-5678-118876`).
      // Recovering it is what lets provenance answer "this frame IS that node" —
      // the frame's own root id is never in its source (verified: `grep -o
      // '5678[:-]118876' index.tsx` returns nothing; the outer wrapper is a plain
      // position:relative div). `slugMatchesNode` is the shared transform, so the
      // reader and the importer that wrote the slug cannot drift.
      const importedFromNodeId = originNodeFromSlug(slug);

      for (const name of tsx) {
        const file = path.join(dir, name);
        try {
          const stat = await fs.stat(file);
          if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
          out.push({
            slug, // the FRAME slug for every file in the dir — they are one candidate
            source: await fs.readFile(file, "utf-8"),
            importedFromNodeId,
            fileKey,
          });
        } catch {
          // Unreadable file — skip it, keep the rest of the frame.
        }
      }
    }
    return out;
  };
}

/**
 * Turn `01-figma-5678-118876` back into `5678:118876`.
 *
 * Round-tripped through the shared `slugMatchesNode` rather than trusted: the
 * digit-grouping is ambiguous in principle (`figma-5678-118-876` would parse three
 * ways), so we only return an id the shared transform CONFIRMS regenerates this
 * exact slug. A slug we cannot confirm yields `undefined`, and provenance's
 * `matchOrigin` still catches it via `slugMatchesNode` directly — this value is
 * belt-and-braces for a host that renames frames.
 */
function originNodeFromSlug(slug: string): string | undefined {
  const m = /^(?:\d+-)?figma-(\d+)-(\d+)$/.exec(slug);
  if (!m) return undefined;
  const nodeId = `${m[1]}:${m[2]}`;
  return slugMatchesNode(slug, nodeId) ? nodeId : undefined;
}
