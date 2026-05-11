import { describe, it, expect, vi } from "vitest";
import { synthesizeSystem } from "../../../server/figma/systemSynth";
import type { SystemSources } from "../../../server/figma/systemSources";

function minimalSources(): SystemSources {
  return {
    styles: {
      paint: [{ id: "1", name: "bg/canvas", hex: "#F6F7F9" }],
      text: [{ id: "2", name: "body/md", family: "Inter", size: 14, weight: 400 }],
      effect: [],
    },
    variables: { color: [], number: [] },
    components: [{ id: "3", name: "Button", isComponentSet: false }],
    sampleFrames: [],
    warnings: [],
  };
}

function cannedReply(obj: any): string {
  return JSON.stringify(obj);
}

describe("synthesizeSystem — happy path", () => {
  it("parses a valid Claude reply into SynthesizedSections", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: cannedReply({
        identity: "A dense utilitarian design system.",
        colors: { entries: [{ name: "bg/canvas", value: "#F6F7F9", role: "background" }], warnings: [] },
        typography: { entries: [{ name: "body/md", value: "Inter 14 400", role: "body" }], warnings: [] },
        spacing: { scale: [4, 8, 16] },
        radii: { scale: [0, 4] },
        shadows: { items: [] },
        components: ["Button"],
        warnings: [],
      }),
      exitCode: 0,
    });
    const out = await synthesizeSystem(minimalSources(), { spawn });
    expect(out.identity).toContain("utilitarian");
    expect(out.colors.entries[0].value).toBe("#F6F7F9");
    expect(out.components).toEqual(["Button"]);
  });
});

describe("synthesizeSystem — validation", () => {
  it("throws when Zod schema rejects (missing required key)", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        // identity missing
        colors: { entries: [], warnings: [] },
        typography: { entries: [], warnings: [] },
        spacing: { scale: [] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: [],
      }),
      exitCode: 0,
    });
    await expect(synthesizeSystem(minimalSources(), { spawn })).rejects.toThrow(/schema mismatch/);
  });

  it("throws when reply is not parseable JSON", async () => {
    const spawn = vi.fn().mockResolvedValue({ text: "not json", exitCode: 0 });
    await expect(synthesizeSystem(minimalSources(), { spawn })).rejects.toThrow(/parse failed/);
  });

  it("throws when spawn exits non-zero", async () => {
    const spawn = vi.fn().mockResolvedValue({ text: "", exitCode: 1 });
    await expect(synthesizeSystem(minimalSources(), { spawn })).rejects.toThrow(/exited 1/);
  });
});

describe("synthesizeSystem — provenance + role coercion", () => {
  it("drops color entries whose hex is not in sources, with warning", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        identity: "x",
        colors: { entries: [
          { name: "bg/canvas", value: "#F6F7F9", role: "background" }, // in sources
          { name: "brand/fake", value: "#DEADBE", role: "accent" },    // NOT in sources
        ], warnings: [] },
        typography: { entries: [], warnings: [] },
        spacing: { scale: [] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: [],
        warnings: [],
      }),
      exitCode: 0,
    });
    const out = await synthesizeSystem(minimalSources(), { spawn });
    expect(out.colors.entries.map((e) => e.name)).toEqual(["bg/canvas"]);
    expect(out.warnings.some((w) => /unsourced value/.test(w))).toBe(true);
  });

  it("drops entries with unknown roles, with warning", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        identity: "x",
        colors: { entries: [
          { name: "foo", value: "#F6F7F9", role: "mystery" },
        ], warnings: [] },
        typography: { entries: [
          { name: "bar", value: "Inter 14", role: "also-mystery" },
        ], warnings: [] },
        spacing: { scale: [] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: [],
        warnings: [],
      }),
      exitCode: 0,
    });
    const out = await synthesizeSystem(minimalSources(), { spawn });
    expect(out.colors.entries).toEqual([]);
    expect(out.typography.entries).toEqual([]);
    expect(out.warnings.filter((w) => /unknown role/.test(w))).toHaveLength(2);
  });

  it("dedupes + sorts components", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        identity: "x",
        colors: { entries: [], warnings: [] },
        typography: { entries: [], warnings: [] },
        spacing: { scale: [16, 4, 8, 4] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: ["Button", "AppShell", "Button", "KpiCard"],
        warnings: [],
      }),
      exitCode: 0,
    });
    const out = await synthesizeSystem(minimalSources(), { spawn });
    expect(out.components).toEqual(["AppShell", "Button", "KpiCard"]);
    expect(out.spacing.scale).toEqual([4, 8, 16]);
  });
});
