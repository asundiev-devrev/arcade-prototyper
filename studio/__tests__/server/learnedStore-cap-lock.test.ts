// @vitest-environment node
//
// The two store changes whose failure mode is DELETING a designer's memory, and
// the one that decides whether the panel is telling the truth:
//
//  1. `capRows` — enforced on every write, so a bug here silently evicts real
//     memories. Pinned rows must survive; the rest go oldest-first by
//     `lastSeenAt`; `hits` must never be the eviction key (a preference stated
//     once and obeyed ever after is the SUCCESS case, and has the lowest hits).
//  2. `mutateRows` / the store lock — the Memory panel (designer-driven) and
//     post-turn capture (silent background job) both read-modify-write the whole
//     array. Without serialisation, capture resurrects a row the designer just
//     deleted.
//  3. `selectRowsWithinRenderBudget` — what the panel's "not currently applied"
//     cue is computed from.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  capRows,
  mutateRows,
  readRows,
  writeRows,
  selectRowsWithinRenderBudget,
  renderLearned,
  MAX_LEARNED_ROWS,
  TRUNCATION_MARK,
  type LearnedRow,
} from "../../server/learnedStore";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-learned-cap-"));
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

/**
 * n rows with STRICTLY increasing `lastSeenAt` — row 0 is the oldest, row n-1 the
 * newest. Built off a real epoch rather than hand-formatted digits so the order
 * is monotonic for any n (a wrapping minute field silently is not).
 */
const EPOCH = Date.parse("2026-01-01T00:00:00.000Z");
function ladder(n: number, over: (i: number) => Partial<LearnedRow> = () => ({})): LearnedRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      id: `r${i}`,
      fact: `fact ${i}`,
      lastSeenAt: new Date(EPOCH + i * 60_000).toISOString(),
      ...over(i),
    }),
  );
}

describe("capRows", () => {
  it("leaves a store within the cap untouched, in order", () => {
    const rows = ladder(5);
    expect(capRows(rows)).toEqual(rows);
  });

  it("evicts the oldest lastSeenAt when over the cap", () => {
    const rows = ladder(MAX_LEARNED_ROWS + 5);
    const kept = capRows(rows);
    expect(kept.length).toBe(MAX_LEARNED_ROWS);
    // The 5 oldest are gone; every survivor is newer than every evictee.
    const keptIds = new Set(kept.map((r) => r.id));
    for (let i = 0; i < 5; i += 1) expect(keptIds.has(`r${i}`)).toBe(false);
    expect(keptIds.has(`r${MAX_LEARNED_ROWS + 4}`)).toBe(true);
  });

  it("keeps every pinned row, even the oldest ones", () => {
    // Designer intent outranks recency. A pinned row silently evicted is the
    // exact failure this cap must not have.
    const rows = ladder(MAX_LEARNED_ROWS + 10, (i) => (i < 3 ? { pinned: true } : {}));
    const kept = capRows(rows);
    expect(kept.length).toBe(MAX_LEARNED_ROWS);
    for (const id of ["r0", "r1", "r2"]) {
      expect(kept.some((r) => r.id === id)).toBe(true);
    }
  });

  it("never evicts on `hits` — a low-hits row is the success case", () => {
    // Newest row has the fewest hits; oldest has the most. Eviction must still
    // take the oldest.
    const n = MAX_LEARNED_ROWS + 1;
    const rows = ladder(n, (i) => ({ hits: n - i }));
    const kept = capRows(rows);
    expect(kept.some((r) => r.id === "r0")).toBe(false); // oldest, highest hits — gone
    expect(kept.some((r) => r.id === `r${n - 1}`)).toBe(true); // newest, 1 hit — kept
  });

  it("preserves the caller's row order among survivors", () => {
    const rows = ladder(MAX_LEARNED_ROWS + 3);
    const kept = capRows(rows);
    const inputOrder = rows.filter((r) => kept.includes(r));
    expect(kept).toEqual(inputOrder);
  });

  it("is applied by writeRows, so the file on disk is capped", () => {
    // The cap is only real if the write path enforces it. A pure function nobody
    // calls protects nothing.
    return (async () => {
      await writeRows("global", ladder(MAX_LEARNED_ROWS + 7));
      const back = await readRows("global");
      expect(back.length).toBe(MAX_LEARNED_ROWS);
      expect(back.some((r) => r.id === "r0")).toBe(false);
    })();
  });
});

describe("mutateRows serialises concurrent writers", () => {
  it("does not lose either of two concurrent mutations on one file", async () => {
    // read-then-write without a lock loses one of these entirely.
    await writeRows("global", [row({ id: "base", fact: "base fact" })]);

    await Promise.all([
      mutateRows("global", undefined, (rows) => ({
        rows: [...rows, row({ id: "a", fact: "fact a" })],
        result: undefined,
      })),
      mutateRows("global", undefined, (rows) => ({
        rows: [...rows, row({ id: "b", fact: "fact b" })],
        result: undefined,
      })),
    ]);

    const back = await readRows("global");
    expect(back.map((r) => r.id).sort()).toEqual(["a", "b", "base"]);
  });

  it("does not resurrect a row a concurrent delete removed", async () => {
    // The real pairing: the designer deletes a memory from the panel while a
    // post-turn capture is reinforcing another one. Last-write-wins put the
    // deleted row straight back.
    await writeRows("global", [
      row({ id: "keep", fact: "keep me" }),
      row({ id: "doomed", fact: "delete me" }),
    ]);

    await Promise.all([
      // Panel delete.
      mutateRows("global", undefined, (rows) => ({
        rows: rows.filter((r) => r.id !== "doomed"),
        result: undefined,
      })),
      // Capture reinforcing an unrelated row.
      mutateRows("global", undefined, (rows) => {
        const hit = rows.find((r) => r.id === "keep");
        if (hit) hit.hits += 1;
        return { rows, result: undefined };
      }),
    ]);

    const back = await readRows("global");
    expect(back.map((r) => r.id)).toEqual(["keep"]);
  });

  it("a rejected mutation does not wedge the queue", async () => {
    await writeRows("global", [row({ id: "base" })]);
    const boom = mutateRows("global", undefined, () => {
      throw new Error("apply blew up");
    });
    await expect(boom).rejects.toThrow("apply blew up");

    await mutateRows("global", undefined, (rows) => ({
      rows: [...rows, row({ id: "after", fact: "after the failure" })],
      result: undefined,
    }));
    expect((await readRows("global")).map((r) => r.id)).toEqual(["base", "after"]);
  });

  it("returns the apply function's result to its own caller", async () => {
    await writeRows("global", [row({ id: "base" })]);
    const n = await mutateRows<number>("global", undefined, (rows) => ({
      rows,
      result: rows.length,
    }));
    expect(n).toBe(1);
  });

  it("queues per file, so global and a project do not block each other", async () => {
    await Promise.all([
      mutateRows("global", undefined, (rows) => ({
        rows: [...rows, row({ id: "g", fact: "global fact" })],
        result: undefined,
      })),
      mutateRows("project", "demo", (rows) => ({
        rows: [...rows, row({ id: "p", fact: "project fact", level: "project" })],
        result: undefined,
      })),
    ]);
    expect((await readRows("global")).map((r) => r.id)).toEqual(["g"]);
    expect((await readRows("project", "demo")).map((r) => r.id)).toEqual(["p"]);
  });
});

describe("selectRowsWithinRenderBudget", () => {
  it("marks nothing as overflow for a small store", () => {
    const { applied, overflow } = selectRowsWithinRenderBudget(ladder(5));
    expect(applied.length).toBe(5);
    expect(overflow).toEqual([]);
  });

  it("splits a large store into what reaches the agent and what does not", () => {
    // 300-char facts blow the render budget long before the row cap.
    const rows = ladder(60, (i) => ({ fact: `fact ${i} ${"x".repeat(300)}` }));
    const { applied, overflow } = selectRowsWithinRenderBudget(rows);
    expect(applied.length).toBeGreaterThan(0);
    expect(overflow.length).toBeGreaterThan(0);
    expect(applied.length + overflow.length).toBe(rows.length);
  });

  it("never puts a pinned row in overflow", () => {
    const rows = ladder(60, (i) => ({
      fact: `fact ${i} ${"x".repeat(300)}`,
      ...(i === 0 ? { pinned: true } : {}),
    }));
    const { applied, overflow } = selectRowsWithinRenderBudget(rows);
    expect(applied.some((r) => r.id === "r0")).toBe(true);
    expect(overflow.some((r) => r.id === "r0")).toBe(false);
  });

  it("agrees with renderLearned about what the agent actually receives", () => {
    // The panel's "not currently applied" cue is only honest if it is computed
    // from the same split the rendered file uses.
    const rows = ladder(60, (i) => ({ fact: `fact ${i} ${"x".repeat(300)}` }));
    const md = renderLearned(rows, "this project");
    const { applied, overflow } = selectRowsWithinRenderBudget(rows);
    for (const r of applied) expect(md).toContain(r.fact);
    for (const r of overflow) expect(md).not.toContain(r.fact);
    expect(md).toContain(`(${overflow.length} ${TRUNCATION_MARK}.)`);
  });
});
