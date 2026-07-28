import { randomUUID } from "node:crypto";
import { readRows, writeRows, type LearnedRow } from "./learnedStore";
import type { ProposedMemory } from "./memoryContract";

/**
 * Persist facts the agent proposed during a turn.
 *
 * The SERVER writes; the agent only proposes. Keeping one writer is what gives
 * the panel stable row ids and stops agent/server double-writes.
 *
 * Never throws: this runs post-turn, fire-and-forget. A failure to remember must
 * never surface as a broken turn.
 */
export async function recordProposedMemories(args: {
  proposals: ProposedMemory[];
  slug: string;
  /** Log what would be written without writing. Used for the rollout dry run. */
  dryRun?: boolean;
}): Promise<{ written: number; reinforced: number; skipped: number }> {
  const result = { written: 0, reinforced: 0, skipped: 0 };
  if (args.proposals.length === 0) return result;

  try {
    const now = new Date().toISOString();
    // Read both levels once: a fact already known GLOBALLY must not be
    // re-recorded per project, or the global row gets shadowed by copies.
    const globalRows = await readRows("global");
    const projectRows = await readRows("project", args.slug);

    let globalDirty = false;
    let projectDirty = false;

    for (const p of args.proposals) {
      const key = normalize(p.fact);
      if (!key) {
        result.skipped += 1;
        continue;
      }

      const existingGlobal = globalRows.find((r) => normalize(r.fact) === key);
      const existingProject = projectRows.find((r) => normalize(r.fact) === key);
      const existing = existingGlobal ?? existingProject;

      if (existing) {
        existing.hits += 1;
        existing.lastSeenAt = now;
        if (!existing.seenInProjects.includes(args.slug)) {
          existing.seenInProjects.push(args.slug);
        }
        if (existing === existingGlobal) globalDirty = true;
        else projectDirty = true;
        result.reinforced += 1;
        continue;
      }

      const row: LearnedRow = {
        id: randomUUID(),
        fact: p.fact,
        level: p.level,
        hits: 1,
        createdAt: now,
        lastSeenAt: now,
        source: "confirmed",
        seenInProjects: [args.slug],
      };
      if (p.level === "global") {
        globalRows.push(row);
        globalDirty = true;
      } else {
        projectRows.push(row);
        projectDirty = true;
      }
      result.written += 1;
    }

    if (!args.dryRun) {
      if (globalDirty) await writeRows("global", globalRows);
      if (projectDirty) await writeRows("project", projectRows, args.slug);
    }
  } catch (err) {
    console.warn(
      `[studio] memory capture failed for ${args.slug}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  return result;
}

/**
 * Dedup key. Case and trailing punctuation differences are the same fact — the
 * agent will not phrase a recurring preference identically twice, and a store
 * full of near-duplicates is what makes memory unreadable.
 */
function normalize(fact: string): string {
  return fact
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
