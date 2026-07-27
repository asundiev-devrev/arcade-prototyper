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
export function renderLearned(rows: LearnedRow[], scope: string): string {
  const header =
    `<!-- LEARNED.md — what Studio has learned about ${scope}.\n` +
    `     Generated from learned.json; edit via the Memory panel, not here. -->\n`;

  if (rows.length === 0) {
    return `${header}\nNothing learned yet.\n`;
  }

  const pinned = rows.filter((r) => r.pinned);
  const rest = rows
    .filter((r) => !r.pinned)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  const lines: string[] = [header, ""];
  let used = header.length + 1;
  const budget = LEARNED_CHAR_CAP - 80; // leave room for the truncation note
  let dropped = 0;

  for (const r of [...pinned, ...rest]) {
    const line = `- ${r.fact}`;
    if (used + line.length + 1 > budget && !r.pinned) {
      dropped += 1;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (dropped > 0) lines.push(`\n(${dropped} older memories not shown.)`);

  const out = lines.join("\n");
  return out.length > LEARNED_CHAR_CAP ? out.slice(0, LEARNED_CHAR_CAP - 3) + "..." : out;
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
 * Persist rows AND re-render the sibling LEARNED.md. Always use this — writing
 * the markdown directly would let the two files drift.
 *
 * No session invalidation: CLAUDE.md @-imports re-resolve every turn (verified
 * against the CLI, including on --resume), so the next turn reads this for free.
 */
export async function writeRows(
  level: MemoryLevel,
  rows: LearnedRow[],
  slug?: string,
): Promise<void> {
  const dir = dirFor(level, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "learned.json"), JSON.stringify(rows, null, 2), "utf-8");
  const scope = level === "global" ? "global" : "this project";
  await fs.writeFile(path.join(dir, "LEARNED.md"), renderLearned(rows, scope), "utf-8");
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
 */
export async function migrateLegacyLearned(level: MemoryLevel, slug?: string): Promise<number> {
  const dir = dirFor(level, slug);
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
  await writeRows(level, rows, slug);
  return rows.length;
}
