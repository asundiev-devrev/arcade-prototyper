// studio/src/export/figma/types.ts
export type ColorRole = "fill" | "stroke" | "text";

export type VariantAxis = {
  prop: string;                      // SLJ prop name, e.g. "variant"
  figmaProp: string;                 // Figma variant property, e.g. "Type"
  valueMap: Record<string, string>;  // {"receiver":"Receiver"}
};

export type TextNodeHint =
  | { strategy: "lowest-depth" }
  | { strategy: "by-name"; name: string };

export type FigmaComponentMapping = {
  arcadeGen: string;
  status: "mapped" | "ambiguous";
  generation: "0.3" | "0.2" | null;
  figma: { componentSetKey: string; setName: string } | null;
  variants: VariantAxis[];
  textNode?: TextNodeHint;
  note: string;
};

/** A mapped entry has a non-null figma target and a concrete generation. */
export function isMappedEntry(
  e: FigmaComponentMapping,
): e is FigmaComponentMapping & { status: "mapped"; figma: NonNullable<FigmaComponentMapping["figma"]>; generation: "0.3" | "0.2" } {
  return e.status === "mapped" && e.figma !== null && (e.generation === "0.3" || e.generation === "0.2");
}
