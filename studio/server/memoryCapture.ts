import { randomUUID } from "node:crypto";
import {
  readRows,
  mutateRows,
  migrateLegacyLearned,
  type LearnedRow,
  type MemoryLevel,
} from "./learnedStore";
import type { ProposedMemory } from "./memoryContract";
import fs from "node:fs/promises";
import path from "node:path";
import { projectsRoot } from "./paths";

export interface CaptureCounts {
  written: number;
  reinforced: number;
  skipped: number;
  /** Rows that earned global scope this turn by recurring in a second project. */
  promoted: number;
}

/** One proposal, with its dedup key precomputed. */
interface Keyed {
  key: string;
  proposal: ProposedMemory;
}

/**
 * Persist facts the agent proposed during a turn.
 *
 * The SERVER writes; the agent only proposes. Keeping one writer is what gives
 * the panel stable row ids and stops agent/server double-writes.
 *
 * Never throws: this runs post-turn, fire-and-forget. A failure to remember must
 * never surface as a broken turn.
 *
 * The returned counts describe what actually landed on disk, not what was
 * intended — they are the rollout instrument (the dry-run log reads them), so a
 * permission or disk failure must not read as "1 new".
 */
export async function recordProposedMemories(args: {
  proposals: ProposedMemory[];
  slug: string;
  /** Log what would be written without writing. Used for the rollout dry run. */
  dryRun?: boolean;
}): Promise<CaptureCounts> {
  const result: CaptureCounts = { written: 0, reinforced: 0, skipped: 0, promoted: 0 };
  if (args.proposals.length === 0) return result;

  try {
    const now = new Date().toISOString();

    // Collapse duplicates WITHIN this turn before touching any store. One reply
    // may legally carry several sentinel lines, and two of them can be the same
    // fact in different wording. Counting each as a reinforcement would push
    // `hits` to 2 off a single turn, which the panel then reads out as "came up
    // 2 times" — a recurrence that never happened.
    const seen = new Set<string>();
    const unique: Keyed[] = [];
    for (const proposal of args.proposals) {
      const key = normalize(proposal.fact);
      if (!key || seen.has(key)) {
        result.skipped += 1;
        continue;
      }
      seen.add(key);
      unique.push({ key, proposal });
    }
    if (unique.length === 0) return result;

    // Migrate any pre-JSON LEARNED.md FIRST. Capture is the first writer that
    // runs with no designer present, and writeRows re-renders LEARNED.md from
    // the row store — so without this, the first captured fact silently replaces
    // a hand-written or agent-appended file, and the migration that would have
    // rescued it never runs again (it no-ops once learned.json exists).
    // Idempotent no-ops after the first time. Skipped in dry mode, which must
    // leave the disk byte-identical.
    if (!args.dryRun) {
      await migrateLegacyLearned("global").catch(() => 0);
      await migrateLegacyLearned("project", args.slug).catch(() => 0);
    }

    // A fact already known GLOBALLY must not be re-recorded per project, or the
    // global row gets shadowed by copies. Route those to the global store even
    // when the agent proposed them as project-level.
    const globalKeys = new Set((await readRows("global")).map((r) => normalize(r.fact)));
    // Earned promotion: the designer has now stated this while working in a
    // DIFFERENT project, which is the evidence that it travels. Route it global
    // instead of writing a second per-project copy.
    const elsewhere = await keysSeenInOtherProjects(args.slug);
    const batches: { level: MemoryLevel; slug?: string; items: Keyed[] }[] = [
      {
        level: "global",
        items: unique.filter(
          (u) => u.proposal.level === "global" || globalKeys.has(u.key) || elsewhere.has(u.key),
        ),
      },
      {
        level: "project",
        slug: args.slug,
        items: unique.filter(
          (u) => !(u.proposal.level === "global" || globalKeys.has(u.key) || elsewhere.has(u.key)),
        ),
      },
    ];

    for (const batch of batches) {
      if (batch.items.length === 0) continue;
      // Each level is its own transaction. Sharing one try meant a failed global
      // write skipped the project write entirely while the counts still claimed
      // both had landed.
      try {
        if (args.dryRun) {
          const rows = await readRows(batch.level, batch.slug);
          add(result, applyBatch(rows, batch, args.slug, now));
          continue;
        }
        const counts = await mutateRows(batch.level, batch.slug, (rows) => ({
          // Read-modify-write inside the store lock: the panel can delete a row
          // mid-capture, and re-reading here is what stops us putting it back.
          rows,
          result: applyBatch(rows, batch, args.slug, now),
        }));
        add(result, counts);
        if (batch.level === "global") {
          result.promoted += batch.items.filter(
            (u) => u.proposal.level !== "global" && !globalKeys.has(u.key) && elsewhere.has(u.key),
          ).length;
        }

      } catch (err) {
        // Nothing landed for this level — report it as skipped, never as written.
        result.skipped += batch.items.length;
        console.warn(
          `[studio] memory capture failed to write ${batch.level} memory for ${args.slug}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } catch (err) {
    console.warn(
      `[studio] memory capture failed for ${args.slug}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  return result;
}

function add(into: CaptureCounts, from: { written: number; reinforced: number }): void {
  into.written += from.written;
  into.reinforced += from.reinforced;
}

/**
 * Keys of facts already recorded in a DIFFERENT project's store.
 *
 * Cross-project recurrence cannot be read off one project's rows: the same fact
 * stated in two projects lands as two separate rows, one per store, each with a
 * single-entry `seenInProjects`. So the evidence has to be gathered by scanning
 * siblings. This is what makes the prompt's promise real — it tells the agent to
 * default to `project` because "Studio promotes a preference once it recurs
 * elsewhere".
 *
 * Reads only the JSON stores (no esbuild-adjacent imports) and never throws — a
 * failed scan degrades to "no promotion", never to a broken turn.
 */
async function keysSeenInOtherProjects(currentSlug: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const entries = await fs.readdir(projectsRoot(), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === currentSlug) continue;
      try {
        const raw = await fs.readFile(
          path.join(projectsRoot(), e.name, "memory", "learned.json"),
          "utf-8",
        );
        const rows = JSON.parse(raw);
        if (!Array.isArray(rows)) continue;
        for (const r of rows) {
          if (r && typeof r.fact === "string") out.add(normalize(r.fact));
        }
      } catch {
        /* project has no store yet, or it is unreadable — skip it */
      }
    }
  } catch {
    /* no projects root — nothing to compare against */
  }
  return out;
}

/**
 * Apply one level's proposals to that level's rows, IN PLACE. Returns what
 * happened so the caller can report disk truth.
 */
function applyBatch(
  rows: LearnedRow[],
  batch: { level: MemoryLevel; items: Keyed[] },
  slug: string,
  now: string,
): { written: number; reinforced: number } {
  let written = 0;
  let reinforced = 0;

  for (const { key, proposal } of batch.items) {
    const existing = rows.find((r) => normalize(r.fact) === key);
    if (existing) {
      existing.hits += 1;
      existing.lastSeenAt = now;
      if (!existing.seenInProjects.includes(slug)) existing.seenInProjects.push(slug);
      reinforced += 1;
      continue;
    }
    rows.push({
      id: randomUUID(),
      fact: proposal.fact,
      // The row's level follows the store it lands in, not the proposal's
      // wording: a project-worded fact routed into the global store IS global.
      level: batch.level,
      hits: 1,
      createdAt: now,
      lastSeenAt: now,
      source: "confirmed",
      seenInProjects: [slug],
    });
    written += 1;
  }
  return { written, reinforced };
}

/**
 * Dedup key. Case and trailing punctuation differences are the same fact — the
 * agent will not phrase a recurring preference identically twice, and a store
 * full of near-duplicates is what makes memory unreadable.
 *
 * Deliberately exact-after-normalisation: paraphrases ("use sentence case for
 * headings" vs "headings use sentence case") still land as separate rows. The
 * bound on that is the row cap in learnedStore plus the designer's delete
 * button, not a similarity heuristic that would silently merge two real facts.
 */
function normalize(fact: string): string {
  return fact
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
