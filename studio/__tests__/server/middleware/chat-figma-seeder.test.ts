// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Idle-guard (#1): the seeder must NOT run while a generation turn is in
// flight, so its synth (a second claude/Bedrock call) never contends with the
// turn's own claude call. hasActiveTurn is module-private state in production;
// mock it so a test can flip "a turn is running" without wiring a real turn.
let mockActiveTurn = false;
vi.mock("../../../server/turnRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/turnRegistry")>();
  return { ...actual, hasActiveTurn: () => mockActiveTurn };
});

import { maybeSeedProjectDesignMd } from "../../../server/middleware/chat";
import { designSyncSkipMarkerPath } from "../../../server/paths";
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
  mockActiveTurn = false;
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

describe("maybeSeedProjectDesignMd — idle guard (#1)", () => {
  it("does NOT run ingest while a generation turn is active", async () => {
    // Fix for the two-Bedrock-calls-contending symptom: while a turn runs, the
    // seeder must not spawn its synth call. It bails BEFORE touching ingest.
    mockActiveTurn = true;
    const ing = mockIngest({ ok: true, ...okResult() });
    const narrations: string[] = [];
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk", emit: (t) => narrations.push(t), ingest: ing,
    });
    expect(ing.ingest).not.toHaveBeenCalled();
    // No file, no "Scanning…" narration, and — crucially — no backoff marker
    // (a busy endpoint is transient; the next idle turn should retry).
    const entries = await fs.readdir(path.join(tmpRoot, "projects", slug));
    expect(entries).not.toContain("DESIGN.md");
    expect(entries).not.toContain(".design-sync-skip.json");
    expect(narrations).toEqual([]);
  });

  it("runs normally once no turn is active", async () => {
    mockActiveTurn = false;
    const ing = mockIngest({ ok: true, ...okResult() });
    await maybeSeedProjectDesignMd({ slug, fileKey: "fk", emit: () => {}, ingest: ing });
    expect(ing.ingest).toHaveBeenCalledTimes(1);
  });
});

describe("maybeSeedProjectDesignMd — skip-marker backoff (#2)", () => {
  it("writes a skip marker on timeout so the next turn does not re-attempt", async () => {
    const neverResolves: FigmaSystemIngest = {
      ingest: vi.fn().mockImplementation(() => new Promise(() => {})),
      getCached: () => undefined,
      getPending: () => undefined,
    };
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk", emit: () => {}, ingest: neverResolves, timeoutMs: 20,
    });
    const raw = await fs.readFile(designSyncSkipMarkerPath(slug), "utf-8");
    const marker = JSON.parse(raw);
    expect(typeof marker.at).toBe("number");
    expect(marker.reason).toMatch(/timed out/);
  });

  it("skips silently (no ingest) while the marker is inside the backoff window", async () => {
    // Pre-write a fresh marker; a second attempt within retryAfterMs must not
    // call ingest and must not emit anything (no repeated "skipped" spam).
    await fs.writeFile(
      designSyncSkipMarkerPath(slug),
      JSON.stringify({ at: 1_000, reason: "timed out after 90s" }),
    );
    const ing = mockIngest({ ok: true, ...okResult() });
    const narrations: string[] = [];
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk", emit: (t) => narrations.push(t), ingest: ing,
      now: () => 1_000 + 60_000, // 1 minute later, well inside a 24h window
      retryAfterMs: 24 * 60 * 60_000,
    });
    expect(ing.ingest).not.toHaveBeenCalled();
    expect(narrations).toEqual([]);
  });

  it("re-attempts once the backoff window has elapsed", async () => {
    await fs.writeFile(
      designSyncSkipMarkerPath(slug),
      JSON.stringify({ at: 1_000, reason: "network" }),
    );
    const ing = mockIngest({ ok: true, ...okResult() });
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk", emit: () => {}, ingest: ing,
      now: () => 1_000 + 25 * 60 * 60_000, // 25h later — past the 24h window
      retryAfterMs: 24 * 60 * 60_000,
    });
    expect(ing.ingest).toHaveBeenCalledTimes(1);
  });

  it("clears a stale marker on a successful sync", async () => {
    await fs.writeFile(
      designSyncSkipMarkerPath(slug),
      JSON.stringify({ at: 1_000, reason: "old failure" }),
    );
    const ing = mockIngest({ ok: true, ...okResult() });
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk", emit: () => {}, ingest: ing,
      now: () => 1_000 + 25 * 60 * 60_000, // past window → attempts + succeeds
      retryAfterMs: 24 * 60 * 60_000,
    });
    await expect(fs.stat(designSyncSkipMarkerPath(slug))).rejects.toThrow();
    const entries = await fs.readdir(path.join(tmpRoot, "projects", slug));
    expect(entries).toContain("DESIGN.md");
  });

  it("neutral skip copy reassures the user it's optional background work", async () => {
    const ing = mockIngest({ ok: false, reason: "network" });
    const narrations: string[] = [];
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk", emit: (t) => narrations.push(t), ingest: ing,
    });
    expect(narrations.some((n) => /optional background step/i.test(n))).toBe(true);
    expect(narrations.some((n) => /generation isn't affected/i.test(n))).toBe(true);
  });
});
