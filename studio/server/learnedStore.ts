import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { globalMemoryDir, projectMemoryDir } from "./paths";

export type MemoryLevel = "global" | "project";

export interface LearnedRow {
  /** Stable, server-assigned. The panel edits/deletes by this. */
  id: string;
  fact: string;
  level: MemoryLevel;
  /**
   * Dedup / reinforcement counter. NOT a value score: it drives neither
   * eviction nor the success metric. A working memory legitimately sits at 1.
   */
  hits: number;
  /** Designer-pinned rows are never evicted by the size cap. */
  pinned?: boolean;
  createdAt: string;
  lastSeenAt: string;
  source: "confirmed" | "explicit";
  /** Project slugs this fact has been observed in — drives promotion to global. */
  seenInProjects: string[];
}

/**
 * Cap on the rendered LEARNED.md. Both levels are @-imported into every turn,
 * so this is per-turn prompt cost.
 */
export const LEARNED_CHAR_CAP = 4_000;

/** The note renderLearned appends when rows did not fit the per-turn budget. */
export const TRUNCATION_MARK = "older memories not shown";

/**
 * Hard cap on stored rows per level. The rendered LEARNED.md is capped by
 * characters (above), but nothing capped the JSON store, so it grew forever:
 * the panel showed every row while the agent only ever received the ones that
 * fit the render budget. A designer looking at a memory they believe is active
 * while it silently no longer applies is worse than losing the oldest ones.
 *
 * Well above the render budget (~80 bullets) on purpose: rows past the budget
 * are still shown, marked as not currently applied, and become active again as
 * newer rows are deleted. This cap only stops unbounded growth.
 */
export const MAX_LEARNED_ROWS = 200;

/**
 * A row is usable only if every field renderLearned/eviction touches is present
 * and the right type. readRows type-guarded only Array.isArray, so a valid-JSON
 * array holding one incomplete row crashed the sort comparator on render —
 * taking down every turn, with no .bak written because JSON.parse succeeded.
 * Hand-editing these files is supported, so a malformed row must degrade to
 * "skip that row", never "lose the store".
 */
function isUsableRow(r: unknown): r is LearnedRow {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.id === "string" && o.id.length > 0 &&
    typeof o.fact === "string" && o.fact.length > 0 &&
    (o.level === "global" || o.level === "project") &&
    typeof o.hits === "number" &&
    typeof o.createdAt === "string" &&
    typeof o.lastSeenAt === "string" &&
    (o.source === "confirmed" || o.source === "explicit") &&
    Array.isArray(o.seenInProjects)
  );
}

function dirFor(level: MemoryLevel, slug?: string): string {
  if (level === "global") return globalMemoryDir();
  if (!slug) throw new Error("project level requires a slug");
  return projectMemoryDir(slug);
}

/**
 * Render rows to the markdown the agent imports. PURE.
 *
 * Eviction order when over the cap: pinned rows always survive; the rest are
 * kept newest-`lastSeenAt`-first. Deliberately NOT keyed on `hits` — a fact
 * that was corrected once and never recurred is the *success* case and has the
 * lowest hits, so evicting by hits would delete what works and keep what
 * doesn't.
 */
function renderHeader(scope: string): string {
  return (
    `<!-- LEARNED.md — what Studio has learned about ${scope}.\n` +
    `     Generated from learned.json; edit via the Memory panel, not here. -->\n`
  );
}

/**
 * Split rows into the ones that fit the per-turn render budget (`applied`) and
 * the ones that do not (`overflow`). PURE.
 *
 * Shared by renderLearned and by the panel, so the panel can tell the designer
 * which memories are actually reaching the agent. Before this existed the panel
 * showed every stored row as if it were active, while the agent only ever saw
 * the ones that fit — a memory you can read, believe in, and that quietly
 * stopped applying.
 */
export function selectRowsWithinRenderBudget(rows: LearnedRow[]): {
  applied: LearnedRow[];
  overflow: LearnedRow[];
} {
  const header = renderHeader("this project"); // length-equivalent for budgeting
  const pinned = rows.filter((r) => r.pinned);
  const rest = rows
    .filter((r) => !r.pinned)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  const applied: LearnedRow[] = [];
  const overflow: LearnedRow[] = [];
  let used = header.length + 1;
  const budget = LEARNED_CHAR_CAP - 80; // leave room for the truncation note

  for (const r of [...pinned, ...rest]) {
    const line = `- ${r.fact}`;
    if (used + line.length + 1 > budget && !r.pinned) {
      overflow.push(r);
      continue;
    }
    applied.push(r);
    used += line.length + 1;
  }
  return { applied, overflow };
}

export function renderLearned(rows: LearnedRow[], scope: string): string {
  const header = renderHeader(scope);

  if (rows.length === 0) {
    return `${header}\nNothing learned yet.\n`;
  }

  const { applied, overflow } = selectRowsWithinRenderBudget(rows);
  const lines: string[] = [header, ""];
  for (const r of applied) lines.push(`- ${r.fact}`);
  if (overflow.length > 0) lines.push(`\n(${overflow.length} ${TRUNCATION_MARK}.)`);

  const out = lines.join("\n");
  return out.length > LEARNED_CHAR_CAP ? out.slice(0, LEARNED_CHAR_CAP - 3) + "..." : out;
}

/**
 * Enforce MAX_LEARNED_ROWS. Pinned rows are exempt; the rest are kept
 * newest-`lastSeenAt`-first — the same non-`hits` ordering the render budget
 * uses, for the same reason (a fact corrected once and never repeated is the
 * success case and has the lowest hits).
 */
export function capRows(rows: LearnedRow[]): LearnedRow[] {
  if (rows.length <= MAX_LEARNED_ROWS) return rows;
  const pinned = rows.filter((r) => r.pinned);
  const rest = rows
    .filter((r) => !r.pinned)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  const keep = new Set([...pinned, ...rest.slice(0, Math.max(0, MAX_LEARNED_ROWS - pinned.length))]);
  // Preserve the caller's original order for the survivors so row order in the
  // file stays stable across writes.
  return rows.filter((r) => keep.has(r));
}

export async function readRows(level: MemoryLevel, slug?: string): Promise<LearnedRow[]> {
  const file = path.join(dirFor(level, slug), "learned.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    return []; // not created yet — normal
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const valid = parsed.filter(isUsableRow);
    const dropped = parsed.length - valid.length;
    if (dropped > 0) {
      // Partial corruption: preserve the original for forensics, return what's usable.
      // Partial recovery beats total loss.
      try {
        await fs.writeFile(`${file}.bak`, raw, "utf-8");
      } catch {
        /* best effort */
      }
      console.warn(`[studio] ${dropped} malformed row(s) in ${file} — preserved as .bak`);
    }
    return valid;
  } catch {
    // Corrupt store: preserve it for forensics, degrade to Rules-only memory.
    // Never delete the designer's data on a parse failure.
    try {
      await fs.writeFile(`${file}.bak`, raw, "utf-8");
    } catch {
      /* best effort */
    }
    console.warn(`[studio] corrupt learned.json at ${file} — preserved as .bak`);
    return [];
  }
}

/**
 * Serialises every mutation of one store file. There are two uncoordinated
 * callers — the Memory panel (designer-driven) and post-turn capture (a silent
 * background job) — and both do read-modify-write on the whole array, so
 * last-write-wins let capture resurrect a memory the designer had just deleted.
 *
 * In-process chain: the Studio server is the single writer process, so a promise
 * queue per file is sufficient. Keyed by absolute path so global and each
 * project queue independently.
 */
const storeLocks = new Map<string, Promise<unknown>>();

async function withStoreLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = storeLocks.get(file) ?? Promise.resolve();
  // Run after the previous holder settles, whether it resolved or rejected — a
  // failed write must not wedge the queue.
  const run = prev.then(fn, fn);
  // The stored tail swallows rejections; the caller still gets the real result.
  const tail = run.then(
    () => {},
    () => {},
  );
  storeLocks.set(file, tail);
  void tail.then(() => {
    if (storeLocks.get(file) === tail) storeLocks.delete(file);
  });
  return run;
}

function storeFile(level: MemoryLevel, slug?: string): string {
  return path.join(dirFor(level, slug), "learned.json");
}

/**
 * Read-modify-write one store as a single critical section. Use this — never
 * `readRows` then `writeRows` — for anything that edits existing rows: between
 * those two calls another caller's write is lost.
 */
export async function mutateRows<T>(
  level: MemoryLevel,
  slug: string | undefined,
  apply: (rows: LearnedRow[]) => { rows: LearnedRow[]; result: T },
): Promise<T> {
  const file = storeFile(level, slug);
  return withStoreLock(file, async () => {
    const current = await readRows(level, slug);
    const { rows, result } = apply(current);
    await writeRowsUnlocked(level, rows, slug);
    return result;
  });
}

async function writeRowsUnlocked(
  level: MemoryLevel,
  rows: LearnedRow[],
  slug?: string,
): Promise<void> {
  const dir = dirFor(level, slug);
  const capped = capRows(rows);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "learned.json"), JSON.stringify(capped, null, 2), "utf-8");
  const scope = level === "global" ? "global" : "this project";
  await fs.writeFile(path.join(dir, "LEARNED.md"), renderLearned(capped, scope), "utf-8");
}

/**
 * Persist rows AND re-render the sibling LEARNED.md. Always use this — writing
 * the markdown directly would let the two files drift.
 *
 * Prefer `mutateRows` when the rows you are writing were derived from a read:
 * this entry point takes the lock for the write itself, but cannot protect a
 * read that happened outside it.
 *
 * No session invalidation: CLAUDE.md @-imports re-resolve every turn (verified
 * against the CLI, including on --resume), so the next turn reads this for free.
 */
export async function writeRows(
  level: MemoryLevel,
  rows: LearnedRow[],
  slug?: string,
): Promise<void> {
  const file = storeFile(level, slug);
  return withStoreLock(file, () => writeRowsUnlocked(level, rows, slug));
}

/** `- fact <!-- date -->` → `fact`. Ignores comments and blank lines. */
function parseLegacyLine(line: string): string | null {
  const t = line.trim();
  if (!t.startsWith("- ")) return null;
  const fact = t
    .slice(2)
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return fact.length > 0 ? fact : null;
}

/**
 * One-time import of a hand-written / agent-appended LEARNED.md into the JSON
 * store. No-op when a JSON store already exists (so it never clobbers) or when
 * the markdown has no bullets. Returns the number of rows imported.
 *
 * Runs inside the store lock: the exists-check and the write must be one step,
 * or a concurrent writer's rows are silently replaced by the migrated ones.
 */
export async function migrateLegacyLearned(level: MemoryLevel, slug?: string): Promise<number> {
  const dir = dirFor(level, slug);
  return withStoreLock(storeFile(level, slug), async () => {
    try {
      await fs.access(path.join(dir, "learned.json"));
      return 0; // already migrated
    } catch {
      /* fall through */
    }

    let md: string;
    try {
      md = await fs.readFile(path.join(dir, "LEARNED.md"), "utf-8");
    } catch {
      return 0;
    }

    const facts = md.split("\n").map(parseLegacyLine).filter((f): f is string => f !== null);
    if (facts.length === 0) return 0;

    // Preserve the original file before overwriting — non-bullet content (headings,
    // paragraphs, trailing prose) is not representable in the row store, so the
    // original is kept verbatim for forensics.
    try {
      await fs.writeFile(path.join(dir, "LEARNED.md.bak"), md, "utf-8");
    } catch {
      // Best effort — a failed backup never breaks migration. The parsed bullets
      // still go into learned.json, and LEARNED.md is regenerated.
    }

    const now = new Date().toISOString();
    const rows: LearnedRow[] = facts.map((fact) => ({
      id: randomUUID(),
      fact,
      level,
      hits: 1,
      createdAt: now,
      lastSeenAt: now,
      source: "confirmed",
      seenInProjects: slug ? [slug] : [],
    }));
    await writeRowsUnlocked(level, rows, slug);
    return rows.length;
  });
}
