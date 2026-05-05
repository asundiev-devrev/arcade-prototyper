// studio/src/lift/mappings/index.ts

import type { MappingEntry } from "../types";
import { PRIMITIVE_MAPPINGS } from "./primitives";
import { COMPOSITE_MAPPINGS } from "./composites";

export const ALL_MAPPINGS: MappingEntry[] = [
  ...PRIMITIVE_MAPPINGS,
  ...COMPOSITE_MAPPINGS,
];

export function findMapping(source: string, name: string): MappingEntry | null {
  return (
    ALL_MAPPINGS.find(
      (m) => m.studio.source === source && m.studio.name === name,
    ) ?? null
  );
}
