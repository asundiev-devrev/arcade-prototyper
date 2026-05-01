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

export interface CompactNode {
  id: string;
  type: NodeType;
  name?: string;
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
  diagnostics: { warnings: string[] };
}

export interface IngestFailure {
  ok: false;
  reason: string;
  source: Pick<IngestSource, "fileKey" | "nodeId" | "url">;
}

export type IngestOutcome = ({ ok: true } & IngestResult) | IngestFailure;
