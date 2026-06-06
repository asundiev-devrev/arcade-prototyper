// studio/src/export/figma/index.ts
export * from "./types";
export { findComponentMapping } from "./componentMap";
export { COMPONENT_ENTRIES } from "./componentEntries";
export { buildTokenMap, OVERRIDES, type VariableSnapshotEntry } from "./tokenMap";
export { resolveTokenForRole } from "./disambiguate";
