// studio/src/lift/types.ts
//
// Pure types for the Lift Manifest subsystem. No imports from "vite",
// "node:fs", or anywhere else with side effects — keep this file importable
// from unit tests, the plugin, the middleware, and the renderer alike.

export type TranslationClass = "mechanical" | "structural" | "judgment";

export interface PropDelta {
  /** Studio prop name. */
  from: string;
  /** Production prop name. Same as `from` when only the value mapping changes. */
  to: string;
  /** Optional mapping from Studio value → production value. */
  valueMap?: Record<string, string>;
  /** Optional free-text note attached to this prop. */
  note?: string;
}

export interface MappingEntry {
  /** What the frame code imports. */
  studio: {
    /** Module specifier, e.g. "arcade", "arcade/components", "arcade-prototypes". */
    source: "arcade" | "arcade/components" | "arcade-prototypes";
    /** Named import, e.g. "Button", "NavSidebar", "VistaPage". */
    name: string;
  };
  /** What the production equivalent is. */
  production: {
    /** Module specifier engineers should import from. */
    source: string;
    /** Exported name in that module. */
    name: string;
  };
  propDeltas: PropDelta[];
  /**
   * Notes about slot/children differences — e.g. Studio's flat children vs.
   * production compound subcomponents. One bullet per line when rendered.
   */
  slotNotes: string[];
  translationClass: TranslationClass;
  /** One-line note surfaced in the manifest when class is "judgment". */
  judgmentNote?: string;
}

export type FrameShape = "list-view" | "settings-form" | "detail" | "ad-hoc";

export interface ScaffoldingItem {
  /** Short label shown in the checklist. */
  label: string;
  /** Path pattern (templated with <entity>, <domain>, etc.) for the engineer. */
  pathPattern?: string;
  /**
   * "required" — engineer must do this
   * "n/a"      — detector knows this shape doesn't need it
   * "done"     — detector inferred this is already present (reserved; unused today)
   */
  status: "required" | "n/a" | "done";
}

export interface FrameImport {
  source: string;
  names: string[];
}

export interface Manifest {
  projectSlug: string;
  frameSlug: string;
  /** Absolute path to the frame's index.tsx on disk. Useful for the agent. */
  frameAbsPath: string;
  intentSummary: string;
  imports: FrameImport[];
  mappings: MappingEntry[];
  /** Entries in `imports` that had no mapping-table match. Surface in the manifest as "unmapped". */
  unmapped: Array<{ source: string; name: string }>;
  shape: FrameShape;
  scaffolding: ScaffoldingItem[];
  figmaUrl?: string;
  screenshotUrl?: string;
  /** Schema version of the emitted manifest. Bump when breaking consumers. */
  schemaVersion: 1;
}
