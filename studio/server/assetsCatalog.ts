import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { buildManifestEntries } from "./kitManifest";

const require = createRequire(import.meta.url);

export interface AssetItem {
  /** Component export name, e.g. "FormModal". */
  name: string;
  /** One-line human description. */
  doc: string;
  /** Relative thumbnail path under prototype-kit/, or null if none. */
  thumb: string | null;
}

export interface IconItem {
  name: string;
  category: string;
  tags: string[];
  /** Inline SVG markup. */
  svg: string;
}

export interface AssetSection {
  kind: "composite" | "component" | "icon";
  items: AssetItem[] | IconItem[];
}

/** Doc text up to the first sentence break, collapsed to one line. */
function firstLine(doc: string): string {
  const collapsed = doc.replace(/\s+/g, " ").trim();
  const dot = collapsed.indexOf(". ");
  return dot === -1 ? collapsed : collapsed.slice(0, dot + 1);
}

export async function buildCompositeSection(kitRoot: string): Promise<AssetSection> {
  const entries = await buildManifestEntries(kitRoot);
  const items: AssetItem[] = entries.map((e) => ({
    name: e.name,
    doc: firstLine(e.doc),
    thumb: `assets-thumbs/${e.name}.png`,
  }));
  return { kind: "composite", items };
}

// Hand-curated allowlist of blessed, renderable, designer-relevant arcade-gen
// components. The barrel exports ~48 things mixing components, hooks, types and
// compound sub-parts; we deliberately show only the visible components here.
// Each name MUST be a real arcade-gen export and gets a thumb at
// assets-thumbs/<Name>.png. Charts are ONE compound component (Chart.Line,
// Chart.Bar, ...) — not per-type exports. Stack covers HStack/VStack variants.
const COMPONENT_CATALOG: { name: string; doc: string }[] = [
  // Actions
  { name: "Button", doc: "Primary action button with variants and sizes." },
  { name: "IconButton", doc: "Compact button showing just an icon." },
  { name: "ButtonGroup", doc: "A row of related buttons joined together." },
  { name: "SplitButton", doc: "A button with an attached dropdown of more actions." },
  { name: "Toggle", doc: "A button that flips between on and off." },
  { name: "ToggleGroup", doc: "A set of toggles where one or more can be active." },
  { name: "Link", doc: "Styled inline navigation link." },
  // Inputs
  { name: "Input", doc: "Single-line text field." },
  { name: "TextArea", doc: "Multi-line text field for longer input." },
  { name: "Select", doc: "Dropdown to pick one option from a list." },
  { name: "Dropdown", doc: "Menu of choices triggered by a control." },
  { name: "Checkbox", doc: "A box that toggles a single option on or off." },
  { name: "Radio", doc: "Selects exactly one option from a group." },
  { name: "Switch", doc: "An on/off toggle styled as a sliding switch." },
  { name: "DatePicker", doc: "Calendar control for choosing a date." },
  { name: "KeyboardShortcut", doc: "Displays a keyboard shortcut as styled keys." },
  // Data display
  { name: "Avatar", doc: "Round image or initials representing a person." },
  { name: "Badge", doc: "Small status or count label." },
  { name: "Tag", doc: "Compact label for categorizing or filtering." },
  { name: "Table", doc: "Rows and columns of structured data." },
  { name: "Accordion", doc: "Stacked sections that expand and collapse." },
  { name: "Loader", doc: "Inline spinner for loading states." },
  { name: "FullscreenLoader", doc: "Full-screen loading overlay." },
  { name: "Widget", doc: "Card-like container for a dashboard tile." },
  { name: "Dashboard", doc: "Grid layout that arranges widgets into a dashboard." },
  { name: "ChatBubble", doc: "Message bubble for chat conversations." },
  // Overlays & feedback
  { name: "Modal", doc: "Centered dialog that overlays the page." },
  { name: "Popover", doc: "Floating panel anchored to a trigger." },
  { name: "Tooltip", doc: "Small hint shown on hover or focus." },
  { name: "Menu", doc: "List of actions in a floating menu." },
  { name: "Toast", doc: "Brief notification that pops in and fades out." },
  { name: "Banner", doc: "Full-width message bar for important notices." },
  // Navigation
  { name: "Tabs", doc: "Row of tabs for switching between views." },
  { name: "Breadcrumb", doc: "Trail showing the current page's location." },
  { name: "Sidebar", doc: "Vertical navigation rail for an app shell." },
  // Layout
  { name: "Stack", doc: "Arranges children in a row or column with spacing." },
  { name: "Grid", doc: "Lays children out on a responsive grid." },
  { name: "Separator", doc: "A thin divider line between content." },
  { name: "ScrollArea", doc: "Scrollable region with styled scrollbars." },
  { name: "ResizablePanel", doc: "Panel the user can drag to resize." },
  // Charts
  { name: "Chart", doc: "Data chart — line, bar, area, pie, and more." },
];

export function buildComponentSection(): AssetSection {
  const items: AssetItem[] = COMPONENT_CATALOG.map((c) => ({
    name: c.name,
    doc: c.doc,
    thumb: `assets-thumbs/${c.name}.png`,
  }));
  return { kind: "component", items };
}

interface RawIcon {
  componentName: string;
  category: string;
  tags?: string[];
  svgContent: string;
}

/** Wrap arcade-gen's inner svg markup into a standalone, renderable <svg>. */
function wrapSvg(inner: string): string {
  // arcade-gen icons are authored on a 32x32 grid (every icon component ships
  // viewBox="0 0 32 32"); match it so thumbnails aren't clipped.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor">${inner}</svg>`;
}

// Arcade-gen clone root. The published @xorkavi/arcade-gen package ships only
// `dist` bundles (the icon manifest is NOT in it), so the icon manifest is only
// reachable in the dev SOURCE tree. Studio already standardises on ARCADE_GEN_ROOT
// (defaults to ~/arcade-gen) for the same reason — see claudeCode.ts / projects.ts
// / validateArcadeImports.mjs, which read $ARCADE_GEN_ROOT/src/components/icons/.
const ARCADE_GEN_ROOT =
  process.env.ARCADE_GEN_ROOT ??
  (process.env.HOME ? path.resolve(process.env.HOME, "arcade-gen") : "/__arcade_gen_unconfigured");

export async function buildIconSection(): Promise<AssetSection> {
  const candidates: string[] = [];
  // Prefer a manifest bundled into the installed package, in case a future
  // package version starts shipping one (forward-compatible; not present today).
  try {
    const pkgEntry = require.resolve("@xorkavi/arcade-gen");
    const pkgRoot = path.resolve(path.dirname(pkgEntry), "..");
    candidates.push(
      path.join(pkgRoot, "dist", "icons", "manifest.json"),
      path.join(pkgRoot, "src", "components", "icons", "manifest.json"),
    );
  } catch {
    /* package not resolvable; fall through to the source-tree clone */
  }
  // The real source today: the arcade-gen dev clone (ARCADE_GEN_ROOT).
  candidates.push(path.join(ARCADE_GEN_ROOT, "src", "components", "icons", "manifest.json"));
  let raw: string | null = null;
  for (const c of candidates) {
    try {
      raw = await fs.readFile(c, "utf-8");
      break;
    } catch {
      /* try next */
    }
  }
  if (raw === null) {
    throw new Error(
      `arcade-gen icon manifest not found (looked in: ${candidates.join(", ")})`,
    );
  }
  const parsed = JSON.parse(raw) as RawIcon[] | { icons: RawIcon[] };
  const list: RawIcon[] = Array.isArray(parsed) ? parsed : parsed.icons;
  const items: IconItem[] = list.map((i) => ({
    name: i.componentName,
    category: i.category,
    tags: i.tags ?? [],
    svg: wrapSvg(i.svgContent),
  }));
  return { kind: "icon", items };
}
