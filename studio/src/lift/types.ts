// studio/src/lift/types.ts
//
// Pure types for the Lift Manifest subsystem. No imports from "vite",
// "node:fs", or anywhere else with side effects — keep this file importable
// from unit tests, the plugin, the middleware, and the renderer alike.

export type TranslationClass =
  | "mechanical"
  | "structural"
  | "judgment"
  /**
   * Shape looks identity-1:1 on the surface (same tag, same children, prop
   * names that rhyme) but the target has a gotcha the agent only learns
   * about at compile/render time — an optional-arg callback signature, a
   * renamed prop whose value semantics changed, a "drop-in" replacement
   * whose theming only works through a specific wrapper class. Added
   * 2026-05-13 after a live render loop surfaced the Tabs.onValueChange /
   * Switch.defaultChecked / inline-style-token class of bugs.
   *
   * Practical rule for authors: if `mechanical` tempts you but the
   * propDeltas or slotNotes carry "actually you have to wrap this" text,
   * it belongs here instead. The renderer emits a `class` attribute the
   * agent can gate on, and the directive copy tells the agent to treat
   * close-but-not-identity entries as "read the propDeltas / slotNotes
   * carefully — a bare rename will not compile or will render wrong."
   */
  | "close-but-not-identity";

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

export interface PriorArtEntry {
  /** Repo-relative path to a real devrev-web file that demonstrates this mapping. */
  path: string;
  /** Short note about what the file illustrates (1–5 words). */
  covers: string;
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
  /**
   * Repo-relative paths to real devrev-web files that demonstrate this
   * mapping in production. Surfaced as `<prior_art>` in the rendered
   * manifest; the agent is instructed to read the first example before
   * writing the lift output. Leave empty when no canonical example exists
   * or when the mapping is mechanical enough that a reference is noise.
   *
   * These paths MUST exist in the target repo. A follow-up PR adds a
   * drift audit that fails loud on stale paths.
   */
  priorArt?: PriorArtEntry[];
  /**
   * Studio props the mapping author has considered. Props in arcade-gen's
   * type definition that are NOT in this list AND NOT in
   * `droppedStudioProps` are coverage holes: the lint in
   * __tests__/lift/propCoverage.test.ts flags them.
   *
   * Empty (or omitted) means "coverage not yet declared" — the lint
   * ignores those entries so mapping authors can fill them in
   * incrementally.
   */
  knownStudioProps?: string[];
  /**
   * Studio props that exist in arcade-gen but have no production
   * equivalent. Surfaced to the downstream agent as a TODO comment so
   * they don't get dropped silently (Chip.appearance was dropped twice
   * during the 2026-05-12 live-lift validation runs).
   */
  droppedStudioProps?: Array<{ prop: string; reason: string }>;
}

export type FrameShape =
  | "list-view"
  | "settings-form"
  | "settings-list"
  | "detail"
  | "ad-hoc";

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

/** Per-frame match of a token or utility-class patch from src/lift/tokens.ts. */
export interface TokenPatchMatch {
  studio: string;
  production: string;
  reason?: string;
}

export interface Manifest {
  projectSlug: string;
  frameSlug: string;
  /** Absolute path to the frame's index.tsx on disk. Useful for the agent. */
  frameAbsPath: string;
  intentSummary: string;
  imports: FrameImport[];
  mappings: MappingEntry[];
  /**
   * Imports with no mapping-table match AND not classified as icons.
   * The icon convention absorbs icon imports; see `iconImports`. Rendered
   * as `<unmapped/>` entries and fed into the default-mapping convention.
   */
  unmapped: Array<{ source: string; name: string }>;
  /**
   * Imports classified as icons by src/lift/icons.ts. Surfaced in a
   * dedicated `<icons>` block alongside the icon convention; absorbed by
   * that convention so they don't count as decision points. Separate from
   * `unmapped` so the renderer and the metric can treat them distinctly.
   */
  iconImports: Array<{ source: string; name: string }>;
  /** CSS custom property patches that actually appear in this frame. */
  tokenPatches: TokenPatchMatch[];
  /** Tailwind utility-class patches that actually appear in this frame. */
  classPatches: TokenPatchMatch[];
  /**
   * True when the frame source contains hand-rolled overlay markup
   * (fixed inset-0 + backdrop). Triggers the `overlay_convention` which
   * tells the agent to use production `<Modal>` instead of preserving
   * the raw divs.
   */
  hasOverlay: boolean;
  /**
   * True when the frame source contains inline `style={{ … }}` that
   * references a theme CSS variable (background, color, borderColor,
   * etc. via `var(--bg-*)` / `var(--fg-*)` / `var(--stroke-*)`). Triggers
   * the `style_attribute_convention`, which rewrites those references to
   * Tailwind utility classes (or `[hsl(var(--X))]` arbitrary values) so
   * the render doesn't silently fall through to `currentColor`. Added
   * 2026-05-13 after a live render loop exposed that devrev-web stores
   * many tokens as raw HSL channels that need `hsl()` wrapping at the
   * use site.
   */
  hasInlineStyleTokens: boolean;
  shape: FrameShape;
  scaffolding: ScaffoldingItem[];
  figmaUrl?: string;
  screenshotUrl?: string;
  /** Schema version of the emitted manifest. Bump when breaking consumers. */
  schemaVersion: 1;
}

/**
 * Agent-facing checklist for verifying a lift renders correctly. Emitted
 * as <render_harness> in the XML. Generated rather than stored — values
 * depend on the frame shape and which conventions fired.
 */
export interface RenderHarness {
  /**
   * Where the agent should drop the lifted file for a first-pass render.
   * Defaults to a "stories under a validation folder" pattern; consumers
   * running the lift against a non-Storybook target can ignore this.
   */
  targetPath: string;
  /** URL pattern for the rendered story; `{frameSlug}` interpolated. */
  iframeUrl: string;
  /**
   * Durable path for the render screenshot — a visual receipt kept alongside
   * the lift file (NOT torn down with the scratch story). A human reviews the
   * lift by looking at this image after the server is gone. Added 2026-06-10
   * after a lift deleted its render and left the reviewer with nothing to see.
   */
  screenshotPath: string;
  /**
   * Concrete, copy-paste scaffold that makes the render ACTUALLY happen
   * rather than degrading to static grep. A bare file under tmp/lift/ has
   * no Storybook story and no dev-server entry, so the agent can't navigate
   * an iframe — and "I verified statically instead" is exactly the gap that
   * shipped a transparent sender bubble (live lift of 01-chat-with-canvas,
   * 2026-06). This field gives the agent the paired-story recipe + the
   * predicted story id so there's no excuse to skip the live render. Added
   * 2026-06-09. Consumers on a non-Storybook target adapt the mechanics but
   * still owe a live render.
   */
  storyScaffold: string;
  /**
   * Short instructions for wrapping the story in a backdrop so card
   * borders have something to sit on. Many DS tokens use near-white
   * values that disappear against a pure-white iframe.
   */
  backdropNote: string;
  /**
   * Checks the agent must run BEFORE declaring the lift done. Open the
   * rendered page in a browser, use devtools / evaluate, confirm each
   * item. A negative answer means a convention fell through and the
   * lift needs another pass.
   */
  checks: string[];
}
