import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { globalMemoryDir, projectMemoryDir } from "../paths";
import {
  readRows,
  writeRows,
  migrateLegacyLearned,
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
          pDir ? readTextOrEmpty(path.join(pDir, "INVENTORY.md")) : Promise.resolve(""),
        ]);
        send(res, 200, {
          global: { rows: globalRows, rules: stripHeaderComments(globalRules) },
          project: { rows: projectRows, rules: stripHeaderComments(projectRules) },
          inventory: stripHeaderComments(inventory),
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

        const rows = await readRows(level, b.slug);
        const patched = applyRowPatch(rows, b.id, {
          fact: b.fact,
          pinned: b.pinned,
          level: b.toLevel,
        });

        // A level change moves the row between stores rather than editing in place.
        const moved = patched.find((r) => r.id === b.id && r.level !== level);
        if (moved) {
          await writeRows(level, patched.filter((r) => r.id !== b.id), b.slug);
          const destSlug = moved.level === "project" ? b.slug : undefined;
          const dest = await readRows(moved.level, destSlug);
          await writeRows(moved.level, [...dest, moved], destSlug);
        } else {
          await writeRows(level, patched, b.slug);
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
        const rows = await readRows(level, b.slug);
        await writeRows(level, rows.filter((r) => r.id !== b.id), b.slug);
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
