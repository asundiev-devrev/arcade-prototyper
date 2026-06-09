// studio/src/export/figma/swapPlan.ts
import type { Box } from "../slj";
import type { FigmaComponentMapping } from "./types";
import type { ManifestComponent, SwapOp } from "./swapOps";
import type { CaptureNode } from "./captureTree";
import { matchByGeometry } from "./geometryMatch";

const TRANSCRIPT_COMPONENTS = new Set(["ChatBubble"]);

/** Find the capture node that visually CONTAINS the transcript: its x-span
 *  covers the bubbles' x-span, its top sits at/above the first bubble, it's
 *  reasonably tall, and among all such wrappers it's the tightest (smallest
 *  area). The converter clips the transcript to the viewport, so we must NOT
 *  require the container box to match the (full-scrollback) bubble bbox. */
function findTranscriptContainer(region: Box, captureNodes: CaptureNode[]): CaptureNode | null {
  const TOL = 24;
  const left = region.x;
  const right = region.x + region.width;
  const candidates = captureNodes.filter(
    (n) =>
      n.width > 0 &&
      n.height > 200 &&
      n.x <= left + TOL &&
      n.x + n.width >= right - TOL &&
      n.y <= region.y + TOL,
  );
  candidates.sort((a, b) => a.width * a.height - b.width * b.height);
  return candidates[0] ?? null;
}

export interface SwapPlanMaps {
  findComponentMapping: (name: string) => FigmaComponentMapping | null;
  tokenNameToVariableKey: (cssTokenName: string) => string | null;
  /** arcade-gen icon name → Icons/* component-set key, or null if unmapped/ambiguous. */
  findIconSetKey: (arcadeGenIconName: string) => string | null;
}

export interface SwapRegions {
  /** Box of the chat transcript container, or null when the frame has none. */
  transcriptRegion: Box | null;
}

/** Resolve the Figma variant map for a manifest component from its props. */
function resolveVariant(mapping: FigmaComponentMapping, props: Record<string, unknown>): Record<string, string> | undefined {
  const variant: Record<string, string> = {};
  for (const axis of mapping.variants) {
    const raw = props[axis.prop];
    if (typeof raw === "string" && axis.valueMap[raw] !== undefined) variant[axis.figmaProp] = axis.valueMap[raw];
  }
  return Object.keys(variant).length > 0 ? variant : undefined;
}

/** Build the text payload for an instance from the mapping's textNode hint. */
function textPayload(mapping: FigmaComponentMapping, text: string | null): { propName?: string; characters: string } | undefined {
  if (text === null || !mapping.textNode) return undefined;
  if (mapping.textNode.strategy === "by-name") return { propName: mapping.textNode.name, characters: text };
  return { characters: text };
}

/** Plan the swaps: inject ChatBubbles into the transcript container as a single
 *  op, then geometry-match each remaining mapped component to a capture node and
 *  emit replaceWithInstance for the discrete region. */
export function planSwap(
  manifest: ManifestComponent[],
  captureNodes: CaptureNode[],
  regions: SwapRegions,
  maps: SwapPlanMaps,
): SwapOp[] {
  const ops: SwapOp[] = [];
  const used = new Set<string>();

  // --- transcript region: inject our bubbles, discard their flat ones ---
  const bubbles = manifest.filter((c) => TRANSCRIPT_COMPONENTS.has(c.component));
  if (bubbles.length > 0 && regions.transcriptRegion) {
    const container = findTranscriptContainer(regions.transcriptRegion, captureNodes);
    if (container) {
      used.add(container.id);
      const instances = bubbles
        .map((b) => {
          const mapping = maps.findComponentMapping(b.component);
          if (!mapping || mapping.status !== "mapped" || !mapping.figma) return null;
          return {
            componentSetKey: mapping.figma.componentSetKey,
            variant: resolveVariant(mapping, b.props),
            box: { x: b.box.x - container.x, y: b.box.y - container.y, width: b.box.width, height: b.box.height },
            text: textPayload(mapping, b.text),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (instances.length > 0) {
        ops.push({ op: "injectInstances", containerNodeId: container.id, clearChildren: true, instances });
      }
    }
  }

  // --- discrete region: geometry-match each remaining mapped component ---
  for (const comp of manifest) {
    if (TRANSCRIPT_COMPONENTS.has(comp.component)) continue;
    const mapping = maps.findComponentMapping(comp.component);
    if (!mapping || mapping.status !== "mapped" || !mapping.figma) continue;
    const candidates = captureNodes.filter((n) => !used.has(n.id));
    const match = matchByGeometry(comp.box, candidates);
    if (!match || match.parentId === null) continue;
    used.add(match.id);
    const iconSetKey = comp.icon ? maps.findIconSetKey(comp.icon) : null;
    const op: SwapOp = {
      op: "replaceWithInstance",
      targetNodeId: match.id,
      componentSetKey: mapping.figma.componentSetKey,
      variant: resolveVariant(mapping, comp.props),
      box: { x: match.x, y: match.y, width: match.width, height: match.height },
      parentNodeId: match.parentId,
      text: textPayload(mapping, comp.text),
    };
    if (iconSetKey) (op as Extract<SwapOp, { op: "replaceWithInstance" }>).icon = { setKey: iconSetKey };
    ops.push(op);
  }
  return ops;
}
