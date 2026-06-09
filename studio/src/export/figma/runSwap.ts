// studio/src/export/figma/runSwap.ts
import type { Box, SljDocument } from "../slj";
import type { ManifestComponent, SwapOp } from "./swapOps";
import { flattenManifest } from "./swapOps";
import type { CaptureNode } from "./captureTree";
import { planSwap, type SwapPlanMaps } from "./swapPlan";

const TRANSCRIPT_COMPONENTS = new Set(["ChatBubble"]);

/** Bounding box enclosing every transcript component in the manifest, or null. */
export function deriveTranscriptRegion(manifest: ManifestComponent[]): Box | null {
  const bubbles = manifest.filter((c) => TRANSCRIPT_COMPONENTS.has(c.component));
  if (bubbles.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of bubbles) {
    minX = Math.min(minX, b.box.x);
    minY = Math.min(minY, b.box.y);
    maxX = Math.max(maxX, b.box.x + b.box.width);
    maxY = Math.max(maxY, b.box.y + b.box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Compose the swap: SLJ → manifest → ops, deriving the transcript region. */
export function buildSwapOps(slj: SljDocument, captureNodes: CaptureNode[], maps: SwapPlanMaps): SwapOp[] {
  const manifest = flattenManifest(slj);
  const transcriptRegion = deriveTranscriptRegion(manifest);
  return planSwap(manifest, captureNodes, { transcriptRegion }, maps);
}
