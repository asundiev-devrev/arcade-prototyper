// studio/src/lib/exportFrameToSlj.ts
import { serializeFrame, type DomReader } from "../export/serializeFrame";
import { buildTokenIndex, tokenNamesFromRoot } from "../export/tokenIndex";
import { SLJ_VERSION, type SljDocument } from "../export/slj";

interface ExportArgs {
  iframe: HTMLIFrameElement;
  projectSlug: string;
  frameSlug: string;
  mode: "light" | "dark";
  width: number;
}

/** Read the same-origin frame iframe's live DOM, serialize to SLJ, POST it. */
export async function exportFrameToSlj(args: ExportArgs): Promise<SljDocument> {
  const doc = args.iframe.contentDocument;
  const win = args.iframe.contentWindow;
  if (!doc || !win) throw new Error("Frame iframe document is unreachable (cross-origin or not loaded)");

  const mount = doc.getElementById("root")?.firstElementChild ?? doc.body.firstElementChild;
  if (!mount) throw new Error("Frame iframe has no mounted content to export");

  // Token index from the iframe's :root computed style (DevRevThemeProvider injected them).
  const rootStyle = win.getComputedStyle(doc.documentElement);
  const tokenNames = tokenNamesFromRoot(rootStyle);
  const tokenIndex = buildTokenIndex(tokenNames, (n) => rootStyle.getPropertyValue(n));

  const reader: DomReader = {
    style: (node) => win.getComputedStyle(node as Element),
    box: (node) => {
      const r = (node as Element).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
  };

  const root = serializeFrame(mount, { reader, tokenIndex });
  const slj: SljDocument = {
    slj: SLJ_VERSION,
    frame: { slug: args.frameSlug, project: args.projectSlug, width: args.width, mode: args.mode },
    root,
  };

  const res = await fetch(`/api/projects/${args.projectSlug}/export/${args.frameSlug}.slj.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slj),
  });
  if (!res.ok) throw new Error(`SLJ save failed: ${res.status}`);
  return slj;
}
