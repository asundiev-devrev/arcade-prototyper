// studio/src/export/figma/componentMap.ts
import type { FigmaComponentMapping } from "./types";
import { COMPONENT_ENTRIES } from "./componentEntries";

const BY_NAME = new Map<string, FigmaComponentMapping>(
  COMPONENT_ENTRIES.map((e) => [e.arcadeGen, e]),
);

export function findComponentMapping(arcadeGenName: string): FigmaComponentMapping | null {
  return BY_NAME.get(arcadeGenName) ?? null;
}
