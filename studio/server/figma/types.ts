/**
 * Types shared across the Figma ingestion pipeline. Kept in one module
 * so the pipeline stages (compact → resolve → classify → assemble) all
 * agree on one shape of IngestResult and don't need to import across
 * sibling files.
 */

export interface IngestSource {
  fileKey: string;
  nodeId: string;
  url: string;
  fetchedAt: string;
}

export type NodeType = "frame" | "text" | "instance" | "group" | "vector" | "image";
export type LayoutDirection = "row" | "col" | "none";
export type SizeAxis = number | "fill" | "hug";

export interface CompactLayout {
  direction: LayoutDirection;
  gap?: number;
  padding?: [number, number, number, number];
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "space-between";
  width?: SizeAxis;
  height?: SizeAxis;
}

export interface CompactStyle {
  fill?: string;
  stroke?: string;
  radius?: number;
  shadow?: string;
}

export interface CompactText {
  content: string;
  style?: string;
}

/**
 * A Figma component instance's identity, carried through compaction so the
 * model can map a region onto a real kit component instead of guessing from
 * geometry. `name` is the component's readable name (e.g. "Navigation Button",
 * "_Item", "Icons/Window"); `props` is the resolved variant/text property map
 * (e.g. { State: "Default", Label: "My Work" }).
 */
export interface CompactComponent {
  name: string;
  props?: Record<string, string>;
}

export interface CompactNode {
  id: string;
  type: NodeType;
  name?: string;
  /**
   * Absolute geometry as [x, y, width, height], in Figma px, expressed
   * RELATIVE to the frame root's origin. Carried on every node so the model
   * sees a real coordinate map rather than reconstructing layout from a
   * thumbnail. Absent only when the raw node had no absoluteBoundingBox.
   */
  bbox?: [number, number, number, number];
  /** Component identity for INSTANCE nodes (see CompactComponent). */
  component?: CompactComponent;
  layout?: CompactLayout;
  style?: CompactStyle;
  text?: CompactText;
  children?: CompactNode[];
}

export interface ResolvedTokens {
  colors: Record<string, string>;
  typography: Record<string, string>;
  spacing: Record<string, number>;
}

export type CompositeConfidence = "high" | "medium" | "low";

export interface CompositeSuggestion {
  composite: string;
  path: string;
  confidence: CompositeConfidence;
  reason: string;
}

export interface IngestPng {
  path: string;
  widthPx: number;
  heightPx: number;
}

export interface IngestResult {
  source: IngestSource;
  png: IngestPng | null;
  tree: CompactNode;
  tokens: ResolvedTokens;
  composites: CompositeSuggestion[];
  /**
   * True once the phase-2 classifier has run. Distinguishes "classified, no
   * composite matched" (composites=[] AND classified=true → a novel design)
   * from "not classified yet" (composites=[] AND classified=false → phase 2
   * still pending). Consumers gating behavior on the absence of a template
   * match MUST check this, or they misfire on every first turn.
   */
  classified: boolean;
  diagnostics: { warnings: string[] };
}

export interface IngestFailure {
  ok: false;
  reason: string;
  source: Pick<IngestSource, "fileKey" | "nodeId" | "url">;
}

export type IngestOutcome = ({ ok: true } & IngestResult) | IngestFailure;

// --- System-wide ingest (file-level scan) ---

export type ColorRole = "background" | "surface" | "text" | "accent" | "status" | "other";
export type TypoRole  = "heading" | "body" | "caption" | "code" | "other";

export interface TokenEntry {
  name: string;
  value: string;
  role: ColorRole | TypoRole;
}

export interface TokenSection {
  entries: TokenEntry[];
  warnings: string[];
}

export interface SynthesizedSections {
  identity: string;
  colors: TokenSection;
  typography: TokenSection;
  spacing: { scale: number[]; notes?: string };
  radii: { scale: number[]; notes?: string };
  shadows: { items: { name: string; css: string }[] };
  components: string[];
  warnings: string[];
}

export interface SystemIngestSource {
  fileKey: string;
  fileName?: string;
  scannedAt: string;
}

export interface SystemIngestResult {
  source: SystemIngestSource;
  sections: SynthesizedSections;
  diagnostics: { warnings: string[]; elapsedMs: number };
}

export type SystemIngestOutcome =
  | ({ ok: true } & SystemIngestResult)
  | { ok: false; reason: string };
