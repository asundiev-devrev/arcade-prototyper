/**
 * Parse a Figma URL into `{ fileId, nodeId }`, as a LEAF module with zero imports.
 *
 * WHY THIS FILE EXISTS SEPARATELY. This is part of the ROUTING LAYER'S INPUT
 * CONTRACT: `planFigmaTurn` takes `nodeIds`, so no host can call the cascade
 * without it. It used to live only in `server/figmaCli.ts`, whose first line is
 * `import { spawn } from "node:child_process"` and which shells out to the
 * `figmanage` binary three times — a module the brain's own portability guard
 * lists as FORBIDDEN. That made the seam self-contradictory: satisfying the input
 * contract required of the host exactly the coupling the brain refused to accept.
 *
 * The designers do not use the Studio desktop app — they work in their own Cursor
 * / Claude Code — so a foreign host has to be able to produce these arguments with
 * no CLI binary, no Figma PAT, and possibly not on macOS. Splitting the pure 10
 * lines out costs nothing; `figmaCli.ts` re-exports them, so every existing call
 * site is untouched. Same move, same reason, as `frameSlug.ts` (extracted out of
 * kitEmitBranch.ts so provenance could read a frame slug without inheriting
 * paths.ts and claudeBin.ts).
 *
 * The host-glue half of `__tests__/server/figma/headlessRouting.test.ts` audits
 * this module's closure alongside the brain's, so the seam's own cost is measured
 * rather than assumed.
 *
 * Pure. No imports, no I/O, no process.env. Do not add any.
 */

export interface ParsedFigmaUrl {
  fileId: string;
  nodeId: string;
}

/**
 * `…/design/<fileId>/Name?node-id=5678-118877&t=<share token>`
 *   → `{ fileId: "<fileId>", nodeId: "5678:118877" }`
 *
 * Two normalisations that the rest of the Figma tree depends on, so do NOT write a
 * second parser anywhere:
 *   - `node-id` uses a DASH in URLs and a COLON in the API. Converted here, which
 *     is why provenance can compare a pasted id against an emitted
 *     `data-figma-id` without either side re-normalising.
 *   - the `&t=<share token>` Figma appends on copy is simply never read, so the
 *     browser copy and the desktop-app copy of one node collapse to one identity.
 *     `chat.ts`'s reference dedup already relies on that.
 *
 * Returns `null` — never throws — for a non-Figma host, a URL with no
 * file/design/proto segment, a missing `node-id`, or unparseable input.
 */
export function parseFigmaUrl(url: string): ParsedFigmaUrl | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("figma.com")) return null;
    const m = u.pathname.match(/\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
    const nodeParam = u.searchParams.get("node-id");
    if (!m || !nodeParam) return null;
    return { fileId: m[1], nodeId: nodeParam.replace(/-/g, ":") };
  } catch {
    return null;
  }
}
