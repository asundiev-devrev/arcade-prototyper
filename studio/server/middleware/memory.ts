import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { globalMemoryDir, projectMemoryDir } from "../paths";
import { readInventoryView } from "../inventory";
import {
  readRows,
  mutateRows,
  migrateLegacyLearned,
  selectRowsWithinRenderBudget,
  type LearnedRow,
  type MemoryLevel,
} from "../learnedStore";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const c of req) buf += c;
  return buf ? JSON.parse(buf) : {};
}
function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/**
 * Apply a designer edit to one row. PURE — the HTTP layer reads, patches, and
 * writes. `hits` is intentionally never touched: a manual edit is not a
 * reinforcement observation.
 */
export function applyRowPatch(
  rows: LearnedRow[],
  id: string,
  patch: { fact?: string; pinned?: boolean; level?: MemoryLevel },
): LearnedRow[] {
  return rows.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r };
    if (typeof patch.fact === "string" && patch.fact.trim().length > 0) {
      next.fact = patch.fact.trim();
    }
    if (typeof patch.pinned === "boolean") next.pinned = patch.pinned;
    if (patch.level === "global" || patch.level === "project") next.level = patch.level;
    return next;
  });
}

/**
 * Move a row between global and project stores. SAFE ORDER — writes to
 * destination FIRST, then removes from source. If anything throws between the
 * two writes (e.g. corrupt destination store), the worst case is a row present
 * in BOTH stores (visible + deletable in the panel) instead of permanent loss.
 * Recoverable duplicate > silent loss.
 */
export async function moveRowBetweenLevels(
  row: LearnedRow,
  sourceLevel: MemoryLevel,
  sourceSlug: string | undefined,
  destLevel: MemoryLevel,
  destSlug: string | undefined,
): Promise<void> {
  // Destination write FIRST, source removal second. If this order were
  // reversed, a throw between the two writes (e.g. a corrupt destination
  // store failing readRows) would remove the row from source and never
  // land it — silent, permanent loss of a designer's memory. In this
  // order the worst case is the row appearing in BOTH stores, which the
  // designer can see and delete. Recoverable duplicate > silent loss.
  //
  // Each step is one locked read-modify-write, so a concurrent capture cannot
  // clobber either store. The two steps are deliberately NOT one transaction —
  // they touch two different files, and the ordering above is the safety net.
  await mutateRows(destLevel, destSlug, (rows) => ({
    rows: [...rows, row],
    result: undefined,
  }));

  await mutateRows(sourceLevel, sourceSlug, (rows) => ({
    rows: rows.filter((r) => r.id !== row.id),
    result: undefined,
  }));
}

async function readTextOrEmpty(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch {
    return "";
  }
}

/** Strip the `<!-- … -->` stub header so the panel shows content, not plumbing. */
function stripHeaderComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, "").trim();
}

/**
 * Tag each row with whether it is actually reaching the agent. The rendered
 * LEARNED.md is capped by characters, so a large store shows the designer more
 * memories than the generator ever receives — a line you can read, believe is
 * active, and never edit, that has silently stopped applying. `applied: false`
 * is what lets the panel say so.
 */
export function markApplied(rows: LearnedRow[]): (LearnedRow & { applied: boolean })[] {
  const { applied } = selectRowsWithinRenderBudget(rows);
  const live = new Set(applied);
  return rows.map((r) => ({ ...r, applied: live.has(r) }));
}

export function memoryMiddleware() {
  return function (req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = req.url ?? "";
    if (!url.startsWith("/api/memory")) return next();

    // GET /api/memory?slug=<slug> — everything the panel renders.
    if (req.method === "GET" && url.startsWith("/api/memory?")) {
      const slug = new URL(url, "http://localhost").searchParams.get("slug") ?? "";
      (async () => {
        // Migrate legacy markdown on first read so pre-existing facts are not
        // orphaned the moment the JSON store becomes authoritative.
        await migrateLegacyLearned("global").catch(() => 0);
        if (slug) await migrateLegacyLearned("project", slug).catch(() => 0);

        const gDir = globalMemoryDir();
        const pDir = slug ? projectMemoryDir(slug) : null;
        const [globalRows, projectRows, globalRules, projectRules, inventory] = await Promise.all([
          readRows("global"),
          slug ? readRows("project", slug) : Promise.resolve([]),
          readTextOrEmpty(path.join(gDir, "RULES.md")),
          pDir ? readTextOrEmpty(path.join(pDir, "RULES.md")) : Promise.resolve(""),
          // Structured, NOT the rendered INVENTORY.md. That file is prompt text
          // for the agent; shown to a designer it reads as a wall of markdown.
          slug ? readInventoryView(slug) : Promise.resolve({ frames: [], composites: [] }),
        ]);
        send(res, 200, {
          // Each level renders its own LEARNED.md, so the budget is per level.
          global: { rows: markApplied(globalRows), rules: stripHeaderComments(globalRules) },
          project: { rows: markApplied(projectRows), rules: stripHeaderComments(projectRules) },
          inventory,
        });
      })().catch((err) => {
        console.warn("[studio] memory GET failed:", err);
        send(res, 500, { error: "memory unavailable" });
      });
      return;
    }

    // PATCH /api/memory/row  { level, slug?, id, fact?, pinned?, toLevel? }
    if (req.method === "PATCH" && url === "/api/memory/row") {
      (async () => {
        const b = await readJson(req);
        const level: MemoryLevel = b.level === "global" ? "global" : "project";
        if (level === "project" && !b.slug) return send(res, 400, { error: "slug required" });
        if (!b.id) return send(res, 400, { error: "id required" });

        // A level change moves the row between stores rather than editing in
        // place, and that needs two stores — so decide first, under the lock,
        // then hand off. In-place edits never leave the lock: a background
        // capture writing the same file between read and write would drop the
        // designer's edit.
        const moved = await mutateRows<LearnedRow | undefined>(level, b.slug, (rows) => {
          const patched = applyRowPatch(rows, b.id, {
            fact: b.fact,
            pinned: b.pinned,
            level: b.toLevel,
          });
          const relocating = patched.find((r) => r.id === b.id && r.level !== level);
          // Leave the source untouched while relocating: moveRowBetweenLevels
          // writes the destination first, then removes from source, so that a
          // throw in between leaves a visible duplicate rather than losing the row.
          return { rows: relocating ? rows : patched, result: relocating };
        });

        if (moved) {
          const destSlug = moved.level === "project" ? b.slug : undefined;
          await moveRowBetweenLevels(moved, level, b.slug, moved.level, destSlug);
        }
        send(res, 200, { ok: true });
      })().catch((err) => {
        console.warn("[studio] memory PATCH failed:", err);
        send(res, 500, { error: "write failed" });
      });
      return;
    }

    // DELETE /api/memory/row  { level, slug?, id }
    if (req.method === "DELETE" && url === "/api/memory/row") {
      (async () => {
        const b = await readJson(req);
        const level: MemoryLevel = b.level === "global" ? "global" : "project";
        if (level === "project" && !b.slug) return send(res, 400, { error: "slug required" });
        // Under the lock: a concurrent capture that read this store before the
        // delete would otherwise write the removed row straight back.
        await mutateRows(level, b.slug, (rows) => ({
          rows: rows.filter((r) => r.id !== b.id),
          result: undefined,
        }));
        send(res, 200, { ok: true });
      })().catch((err) => {
        console.warn("[studio] memory DELETE failed:", err);
        send(res, 500, { error: "write failed" });
      });
      return;
    }

    // POST /api/memory/rule  { level, slug?, text }  — replaces RULES.md body.
    // RULES.md stays plain markdown: it is hand-authored and no code needs row
    // identity in it.
    if (req.method === "POST" && url === "/api/memory/rule") {
      (async () => {
        const b = await readJson(req);
        const level: MemoryLevel = b.level === "global" ? "global" : "project";
        if (level === "project" && !b.slug) return send(res, 400, { error: "slug required" });
        if (typeof b.text !== "string") return send(res, 400, { error: "text required" });
        const dir = level === "global" ? globalMemoryDir() : projectMemoryDir(b.slug);
        const scope = level === "global" ? "global" : "this project";
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, "RULES.md"),
          `<!-- RULES.md — your standing instructions for ${scope}. Hand-written.\n` +
            `     The generator reads this every turn but never edits it. -->\n\n` +
            `${b.text.trim()}\n`,
          "utf-8",
        );
        send(res, 200, { ok: true });
      })().catch((err) => {
        console.warn("[studio] memory rule write failed:", err);
        send(res, 500, { error: "write failed" });
      });
      return;
    }

    return next();
  };
}
