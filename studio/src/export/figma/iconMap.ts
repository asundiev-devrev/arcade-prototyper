// studio/src/export/figma/iconMap.ts
import { ICON_ENTRIES, type IconMapping } from "./iconEntries";

const BY_NAME = new Map<string, IconMapping>(ICON_ENTRIES.map((e) => [e.arcadeGen, e]));

/** Find the icon mapping for an arcade-gen icon component name. Returns the entry
 *  (which may have figma:null for an ambiguous icon), or null if unknown. */
export function findIconMapping(arcadeGenName: string): IconMapping | null {
  return BY_NAME.get(arcadeGenName) ?? null;
}
