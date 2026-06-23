import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "./paths";
import { runClaudeTurn } from "./claudeCode";
import { resolveClaudeBin } from "./claudeBin";
import { getProject, appendHistory, clearAllProjectSessions } from "./projects";
import {
  deleteComponent,
  removeComponentFromManifest,
  componentExists,
} from "./componentStore";
import { findComponentUsages, type ComponentUsage } from "./componentUsage";

export interface DeleteComponentDeps {
  runTurn?: typeof runClaudeTurn;
  loadProject?: typeof getProject;
  resolveBin?: () => string;
  writeHistory?: typeof appendHistory;
  /** Overridable usage finder (tests). */
  findUsages?: typeof findComponentUsages;
  /** Overridable session clearer (tests). */
  clearSessions?: typeof clearAllProjectSessions;
}

/**
 * Prompt that strips a deleted component from one frame. The component is being
 * removed from the library; the frame must no longer import or render it, but
 * everything else stays intact.
 */
export function buildRemovalPrompt(name: string, frameSlug: string): string {
  return [
    `The component ${name} has been deleted from the library.`,
    `It is imported from "arcade-user/${name}" somewhere in frames/${frameSlug}/.`,
    `The import may be in index.tsx OR in a nested sub-file (e.g.`,
    `pages/Something.tsx, a sidebar, a helper). First locate every file under`,
    `frames/${frameSlug}/ that imports or uses ${name} — search the whole frame`,
    `directory, do not assume it is index.tsx.`,
    ``,
    `In EVERY file that references it:`,
    `- Delete the \`import { ${name} } from "arcade-user/${name}";\` line.`,
    `- Remove every \`<${name} ... />\` / \`<${name}>...</${name}>\` usage. If a`,
    `  usage wrapped meaningful content, keep the inner content; otherwise drop`,
    `  the element entirely.`,
    `- Change NOTHING else. Do not restructure the frame, retheme, or touch`,
    `  other components. The frame must still render after the edit.`,
    ``,
    `No file under frames/${frameSlug}/ may still import "arcade-user/${name}"`,
    `when you are done. A reply without an Edit/Write tool call is a failed turn.`,
  ].join("\n");
}

/**
 * Delete a saved component and rewrite every frame that used it.
 *
 * Strategy (background, rewrite-first — frames never go blank):
 *   1. Find frames importing `arcade-user/<name>`.
 *   2. If none, hard-delete now (file + thumb + manifest) and return.
 *   3. If some, remove the manifest entry immediately so the card disappears
 *      from the library, but KEEP the .tsx on disk so the frames' imports keep
 *      resolving. Then, in the background, run a generator turn per affected
 *      frame to strip the import + usages; once a re-scan shows no frame still
 *      references it, remove the .tsx + thumb.
 *
 * Returns synchronously after kicking off background work. The caller (the
 * DELETE route) responds immediately; progress shows as chat breadcrumbs.
 */
export async function deleteComponentAndRewriteFrames(
  name: string,
  deps: DeleteComponentDeps = {},
): Promise<{
  status: "deleted" | "rewriting";
  frames: ComponentUsage[];
  /** Resolves when background rewrites + file removal finish. The DELETE route
   *  ignores this (fire-and-forget); tests await it for determinism. Absent
   *  when nothing ran in the background. */
  done?: Promise<void>;
}> {
  const findUsages = deps.findUsages ?? findComponentUsages;
  const clearSessions = deps.clearSessions ?? clearAllProjectSessions;

  const usages = await findUsages(name);
  if (usages.length === 0) {
    await deleteComponent(name); // file + thumb + manifest
    // Kit catalog changed → next turn must re-read the system prompt.
    await clearSessions().catch(() => {});
    return { status: "deleted", frames: [] };
  }

  // Card vanishes from the library now; file stays so frames keep resolving.
  await removeComponentFromManifest(name);
  await clearSessions().catch(() => {});

  // Background: rewrite each affected frame, then remove the file when safe.
  const done = rewriteAndFinalize(name, usages, deps);
  void done.catch(() => {}); // fire-and-forget; never an unhandled rejection

  return { status: "rewriting", frames: usages, done };
}

async function rewriteAndFinalize(
  name: string,
  usages: ComponentUsage[],
  deps: DeleteComponentDeps,
): Promise<void> {
  const runTurn = deps.runTurn ?? runClaudeTurn;
  const loadProject = deps.loadProject ?? getProject;
  const resolveBin = deps.resolveBin ?? resolveClaudeBin;
  const writeHistory = deps.writeHistory ?? appendHistory;

  // One turn per affected frame, grouped by project so we reuse the project's
  // session. Frames in the same project are rewritten sequentially (shared
  // session); different projects could run concurrently but sequential keeps
  // it simple and avoids hammering Bedrock.
  for (const u of usages) {
    let project;
    try {
      project = await loadProject(u.slug);
    } catch {
      project = null;
    }
    if (!project) continue;

    const stamp = new Date().toISOString();
    await writeHistory(u.slug, {
      id: `component-remove-start:${name}:${u.frameSlug}:${stamp}`,
      role: "system",
      content: `Removing **${name}** from **${u.frameSlug}** — it was deleted from the library.`,
      createdAt: stamp,
    }).catch(() => {});

    try {
      await runTurn({
        cwd: projectDir(u.slug),
        bin: resolveBin(),
        sessionId: project.sessionId,
        prompt: buildRemovalPrompt(name, u.frameSlug),
        onEvent: () => {},
      });
    } catch (err) {
      console.warn(`[componentDeletion] rewrite ${u.slug}/${u.frameSlug} failed:`, err);
      await writeHistory(u.slug, {
        id: `component-remove-failed:${name}:${u.frameSlug}:${new Date().toISOString()}`,
        role: "system",
        content: `Couldn't auto-remove **${name}** from **${u.frameSlug}**. Ask the agent to remove it if the frame looks wrong.`,
        createdAt: new Date().toISOString(),
      }).catch(() => {});
    }
  }

  // Finalize: only remove the file once no frame still references it, so a
  // failed rewrite never leaves a frame with a dangling import (blank frame).
  const remaining = await (deps.findUsages ?? findComponentUsages)(name);
  if (remaining.length === 0) {
    await deleteComponent(name); // removes file + thumb (manifest already gone)
  } else if (await componentExists(name)) {
    console.warn(
      `[componentDeletion] keeping ${name}.tsx — still used by ${remaining.length} frame(s) after rewrite`,
    );
  }
}
