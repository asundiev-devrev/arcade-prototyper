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
import { FIGMA_ORIGIN_FILE } from "../figmaOrigin";
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
 * IT COMES FROM THE IMPORTER'S OWN PER-FRAME RECORD (`FIGMA_ORIGIN_FILE`), which
 * the kit-emit branch writes at import time because that is the one moment the
 * real key is known for certain.
 *
 * IT USED TO COME FROM `LIFT.json#intentSummary`, AND THAT WAS WRONG — a spec
 * review caught it, and it is worth recording because the mistake read as verified.
 * `liftEmitPlugin.ts` sets `intentSummary: await readFirstUserPrompt(slug)`, which
 * returns the FIRST user message of the whole PROJECT, not the prompt that created
 * this frame. Verified on disk: all three frames of the live
 * `implement-this-precisely-3` carry a byte-identical `intentSummary`, including
 * `02-figma-5678-118907`, which was imported from a different node. So the old
 * derivation stamped the project's first file key onto EVERY frame, and it failed
 * in both directions on a multi-file project: it suppressed genuine provenance
 * hits on later-imported files (the original bug, on the very project shape that
 * motivated file scoping) AND it accepted the colliding id it was built to reject.
 * The original test passed only because it hand-wrote a per-frame `intentSummary`
 * the real writer never produces for frame 2+.
 *
 * Returns `undefined` for any frame with no record — every frame written before
 * this fix, and every LLM-authored frame — and that is a FEATURE: provenance treats
 * a missing key as "unknown", never as "mismatch", so such a frame keeps today's
 * behaviour. A WRONG key is strictly worse than none, because it both blocks real
 * hits and invents false ones.
 */
async function readFileKey(projectSlug: string, frameSlug: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(
      path.join(frameDir(projectSlug, frameSlug), FIGMA_ORIGIN_FILE),
      "utf-8",
    );
    const key = JSON.parse(raw)?.fileKey;
    return typeof key === "string" && key.length > 0 ? key : undefined;
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
