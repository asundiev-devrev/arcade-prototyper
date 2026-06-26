import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import { expandFrame } from "./expandFrame";
import { aiExpandFrame } from "./aiExpand";

/** After a generation turn, flatten any top-level full-page composite in each
 *  changed frame so the frame is directly editable. Best-effort, per-frame
 *  isolated — never throws (must not fail the turn). */
export async function expandChangedFrames(slug: string, changedFrameSlugs: string[]): Promise<void> {
  for (const frameSlug of changedFrameSlugs) {
    try {
      const file = path.join(frameDir(slug, frameSlug), "index.tsx");
      const base = frameDir(slug, frameSlug);
      if (!path.resolve(file).startsWith(path.resolve(base))) continue;
      const source = await fs.readFile(file, "utf-8");
      const r = expandFrame(source);
      if (r.changed) {
        await fs.writeFile(file, r.source, "utf-8");
      } else if (r.needsAi) {
        await aiExpandFrame(slug, frameSlug, r.needsAi);
      }
    } catch (err) {
      console.warn(`[expand] skipped ${frameSlug}:`, err instanceof Error ? err.message : err);
    }
  }
}
