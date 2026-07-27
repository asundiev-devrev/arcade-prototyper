// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  renderLearned,
  readRows,
  writeRows,
  migrateLegacyLearned,
  LEARNED_CHAR_CAP,
  type LearnedRow,
} from "../../server/learnedStore";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-learned-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function row(over: Partial<LearnedRow> = {}): LearnedRow {
  return {
    id: "r1",
    fact: "Prefer neutral gray for active nav rows",
    level: "global",
    hits: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-01T00:00:00.000Z",
    source: "confirmed",
    seenInProjects: ["demo"],
    ...over,
  };
}

describe("renderLearned", () => {
  it("renders one bullet per fact", () => {
    const out = renderLearned([row(), row({ id: "r2", fact: "Concise empty states" })], "global");
    expect(out).toContain("- Prefer neutral gray for active nav rows");
    expect(out).toContain("- Concise empty states");
  });

  it("renders a readable placeholder when there are no rows", () => {
    const out = renderLearned([], "this project");
    expect(out).toMatch(/nothing learned yet/i);
  });

  it("evicts by oldest lastSeenAt, NOT by hits", () => {
    // The working memory (hits:1, recent) must outlive the failing one
    // (hits:99, stale). Eviction on hits would delete exactly what works.
    const filler = "x".repeat(600);
    const rows: LearnedRow[] = [
      row({ id: "stale", fact: `STALE ${filler}`, hits: 99, lastSeenAt: "2020-01-01T00:00:00.000Z" }),
      row({ id: "fresh", fact: `FRESH ${filler}`, hits: 1, lastSeenAt: "2026-07-27T00:00:00.000Z" }),
    ];
    // Pad past the cap so eviction must engage.
    for (let i = 0; i < 20; i++) {
      rows.push(row({ id: `p${i}`, fact: `PAD${i} ${filler}`, lastSeenAt: "2021-01-01T00:00:00.000Z" }));
    }
    const out = renderLearned(rows, "global");
    expect(out.length).toBeLessThanOrEqual(LEARNED_CHAR_CAP);
    expect(out).toContain("FRESH");
    expect(out).not.toContain("STALE");
  });

  it("never evicts a pinned row", () => {
    const filler = "y".repeat(600);
    const rows: LearnedRow[] = [
      row({ id: "pin", fact: `PINNED ${filler}`, pinned: true, lastSeenAt: "2019-01-01T00:00:00.000Z" }),
    ];
    for (let i = 0; i < 20; i++) {
      rows.push(row({ id: `p${i}`, fact: `PAD${i} ${filler}`, lastSeenAt: "2026-01-01T00:00:00.000Z" }));
    }
    const out = renderLearned(rows, "global");
    expect(out).toContain("PINNED");
  });
});

describe("readRows / writeRows", () => {
  it("round-trips rows through JSON", async () => {
    await writeRows("global", [row()]);
    const back = await readRows("global");
    expect(back).toHaveLength(1);
    expect(back[0].fact).toBe("Prefer neutral gray for active nav rows");
  });

  it("writes the rendered markdown alongside the JSON", async () => {
    await writeRows("global", [row()]);
    const md = fs.readFileSync(path.join(tmp, "memory", "LEARNED.md"), "utf-8");
    expect(md).toContain("Prefer neutral gray");
  });

  it("writes project rows under the project dir", async () => {
    await writeRows("project", [row({ level: "project" })], "demo");
    const md = fs.readFileSync(
      path.join(tmp, "projects", "demo", "memory", "LEARNED.md"),
      "utf-8",
    );
    expect(md).toContain("Prefer neutral gray");
  });

  it("returns [] when the store does not exist", async () => {
    expect(await readRows("global")).toEqual([]);
  });

  it("returns [] and preserves a corrupt store as .bak", async () => {
    const dir = path.join(tmp, "memory");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "learned.json"), "{ not json");
    expect(await readRows("global")).toEqual([]);
    expect(fs.existsSync(path.join(dir, "learned.json.bak"))).toBe(true);
  });
});

describe("migrateLegacyLearned", () => {
  it("imports hand-written LEARNED.md bullets as rows", async () => {
    const dir = path.join(tmp, "memory");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "LEARNED.md"),
      "<!-- LEARNED.md — header comment -->\n- Prefer concise microcopy in empty states <!-- 2026-06-04 -->\n",
    );
    const n = await migrateLegacyLearned("global");
    expect(n).toBe(1);
    const rows = await readRows("global");
    expect(rows[0].fact).toBe("Prefer concise microcopy in empty states");
    expect(rows[0].source).toBe("confirmed");
  });

  it("is a no-op when a JSON store already exists", async () => {
    await writeRows("global", [row()]);
    expect(await migrateLegacyLearned("global")).toBe(0);
  });

  it("is a no-op for a stub-only file", async () => {
    const dir = path.join(tmp, "memory");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "LEARNED.md"), "<!-- LEARNED.md — header only -->\n");
    expect(await migrateLegacyLearned("global")).toBe(0);
  });
});
