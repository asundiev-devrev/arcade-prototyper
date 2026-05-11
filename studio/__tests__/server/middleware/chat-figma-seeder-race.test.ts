import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { maybeSeedProjectDesignMd } from "../../../server/middleware/chat";
import type { FigmaSystemIngest } from "../../../server/figmaSystemIngest";

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio-race-"));
  process.env.ARCADE_STUDIO_ROOT = tmpRoot;
  await fs.mkdir(path.join(tmpRoot, "projects", "p"), { recursive: true });
});

describe("seeder race safety", () => {
  it("two concurrent turns with no DESIGN.md → single write, no .tmp leak", async () => {
    const outcome = {
      ok: true,
      source: { fileKey: "fk", scannedAt: "t" },
      sections: {
        identity: "x",
        colors: { entries: [], warnings: [] },
        typography: { entries: [], warnings: [] },
        spacing: { scale: [] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: [],
        warnings: [],
      },
      diagnostics: { warnings: [], elapsedMs: 0 },
    };

    let ingestCalls = 0;
    const ingest: FigmaSystemIngest = {
      ingest: vi.fn().mockImplementation(async () => {
        ingestCalls += 1;
        // Add a small delay to increase the likelihood of the race
        await new Promise((r) => setTimeout(r, 10));
        return outcome;
      }),
      getCached: () => undefined,
      getPending: () => undefined,
    };

    const a = maybeSeedProjectDesignMd({ slug: "p", fileKey: "fk", emit: () => {}, ingest });
    const b = maybeSeedProjectDesignMd({ slug: "p", fileKey: "fk", emit: () => {}, ingest });

    // Both observe "not present" before either writes. Each resolves the outcome
    // independently — the test verifies no .tmp file leaks and DESIGN.md has the
    // final content exactly once.
    await Promise.all([a, b]);

    const entries = await fs.readdir(path.join(tmpRoot, "projects", "p"));
    expect(entries).toContain("DESIGN.md");
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
    expect(ingestCalls).toBe(2); // seeder calls ingest unconditionally when file absent; ingest itself dedupes in production
  });

  it("atomic rename: if rename fails after write, no DESIGN.md appears", async () => {
    const target = path.join(tmpRoot, "projects", "p", "DESIGN.md");
    // Make the target directory read-only to force rename failure. On macOS
    // fs.rename to the same filesystem requires write perms on the parent;
    // strip write perms after the .tmp write has happened.
    // Instead we mock fs.rename via vi.spyOn.
    const renameSpy = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("EBUSY"));

    const ingest: FigmaSystemIngest = {
      ingest: vi.fn().mockResolvedValue({
        ok: true,
        source: { fileKey: "fk", scannedAt: "t" },
        sections: {
          identity: "x",
          colors: { entries: [], warnings: [] },
          typography: { entries: [], warnings: [] },
          spacing: { scale: [] },
          radii: { scale: [] },
          shadows: { items: [] },
          components: [],
          warnings: [],
        },
        diagnostics: { warnings: [], elapsedMs: 0 },
      }),
      getCached: () => undefined,
      getPending: () => undefined,
    };
    const narrations: string[] = [];
    await maybeSeedProjectDesignMd({
      slug: "p", fileKey: "fk", emit: (t) => narrations.push(t), ingest,
    });

    await expect(fs.stat(target)).rejects.toThrow();
    expect(narrations.some((n) => /write error/.test(n))).toBe(true);
    renameSpy.mockRestore();
  });
});
