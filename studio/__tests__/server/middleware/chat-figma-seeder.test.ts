// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { maybeSeedProjectDesignMd } from "../../../server/middleware/chat";
import type { FigmaSystemIngest } from "../../../server/figmaSystemIngest";
import type { SystemIngestResult } from "../../../server/figma/types";

function okResult(fileKey = "fk"): SystemIngestResult {
  return {
    source: { fileKey, scannedAt: "2026-05-11T00:00:00Z" },
    sections: {
      identity: "x",
      colors: { entries: [{ name: "bg", value: "#FFF", role: "background" }], warnings: [] },
      typography: { entries: [], warnings: [] },
      spacing: { scale: [] },
      radii: { scale: [] },
      shadows: { items: [] },
      components: ["Button"],
      warnings: [],
    },
    diagnostics: { warnings: [], elapsedMs: 10 },
  };
}

let tmpRoot: string;
let slug: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio-seeder-"));
  slug = "proj";
  process.env.ARCADE_STUDIO_ROOT = tmpRoot;
  await fs.mkdir(path.join(tmpRoot, "projects", slug), { recursive: true });
});

function mockIngest(outcome: any): FigmaSystemIngest {
  return {
    ingest: vi.fn().mockResolvedValue(outcome),
    getCached: () => undefined,
    getPending: () => undefined,
  };
}

describe("maybeSeedProjectDesignMd", () => {
  it("writes DESIGN.md on first turn when absent", async () => {
    const ing = mockIngest({ ok: true, ...okResult() });
    const narrations: string[] = [];
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk",
      emit: (t) => narrations.push(t),
      ingest: ing,
    });
    const md = await fs.readFile(path.join(tmpRoot, "projects", slug, "DESIGN.md"), "utf-8");
    expect(md).toContain("# Design system (from Figma)");
    expect(narrations.some((n) => /Synced design system/.test(n))).toBe(true);
    expect(ing.ingest).toHaveBeenCalledTimes(1);
  });

  it("no-ops when DESIGN.md already exists (user-owns-file invariant)", async () => {
    const filePath = path.join(tmpRoot, "projects", slug, "DESIGN.md");
    await fs.writeFile(filePath, "USER EDITED CONTENT");
    const ing = mockIngest({ ok: true, ...okResult() });
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk", emit: () => {}, ingest: ing,
    });
    const md = await fs.readFile(filePath, "utf-8");
    expect(md).toBe("USER EDITED CONTENT");
    expect(ing.ingest).not.toHaveBeenCalled();
  });

  it("no-ops when fileKey is missing (no Figma URL in prompt)", async () => {
    const ing = mockIngest({ ok: true, ...okResult() });
    await maybeSeedProjectDesignMd({
      slug, fileKey: null, emit: () => {}, ingest: ing,
    });
    expect(ing.ingest).not.toHaveBeenCalled();
  });

  it("emits skip narration on failure outcome, does not throw", async () => {
    const ing = mockIngest({ ok: false, reason: "network" });
    const narrations: string[] = [];
    await expect(maybeSeedProjectDesignMd({
      slug, fileKey: "fk",
      emit: (t) => narrations.push(t),
      ingest: ing,
    })).resolves.toBeUndefined();
    expect(narrations.some((n) => /sync skipped/.test(n) && /network/.test(n))).toBe(true);
  });

  it("writes atomically via .tmp + rename", async () => {
    const ing = mockIngest({ ok: true, ...okResult() });
    await maybeSeedProjectDesignMd({ slug, fileKey: "fk", emit: () => {}, ingest: ing });
    const entries = await fs.readdir(path.join(tmpRoot, "projects", slug));
    expect(entries).toContain("DESIGN.md");
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });

  it("emits 'Scanning…' progress narration before ingest work starts", async () => {
    // Without this, a slow sync looks indistinguishable from the main claude
    // turn silently thinking — beta tester reported "10m 6s, no output".
    const ing = mockIngest({ ok: true, ...okResult() });
    const narrations: string[] = [];
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk",
      emit: (t) => narrations.push(t),
      ingest: ing,
    });
    expect(narrations[0]).toMatch(/Scanning/);
    // And "Synced" comes later — progress narration is additive, not a replacement.
    expect(narrations.some((n) => /Synced design system/.test(n))).toBe(true);
  });

  it("skips with 'timed out' reason when ingest never resolves within timeoutMs", async () => {
    // Root cause of the bug this test guards: fetchSystemSources spawns
    // four figmanage subprocesses + up to 8 PNG exports with no timeouts.
    // A hung figmanage means ingest.ingest() never returns. Before this
    // fix, the whole chat turn waited silently for minutes. Now the seeder
    // gives up after its own wall clock and narrates "skipped".
    const ing: FigmaSystemIngest = {
      ingest: vi.fn().mockImplementation(() => new Promise(() => { /* never resolves */ })),
      getCached: () => undefined,
      getPending: () => undefined,
    };
    const narrations: string[] = [];
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk",
      emit: (t) => narrations.push(t),
      ingest: ing,
      timeoutMs: 30,
    });
    expect(narrations.some((n) => /sync skipped.*timed out/i.test(n))).toBe(true);
    // And the file was NOT written.
    const entries = await fs.readdir(path.join(tmpRoot, "projects", slug));
    expect(entries).not.toContain("DESIGN.md");
  });
});
