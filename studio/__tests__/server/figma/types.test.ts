import { describe, it, expect } from "vitest";
import type {
  ColorRole, TypoRole, TokenEntry, TokenSection, SynthesizedSections,
  SystemIngestResult, SystemIngestOutcome,
} from "../../../server/figma/types";

describe("figma system types", () => {
  it("ColorRole covers the fixed enum", () => {
    const roles: ColorRole[] = ["background", "surface", "text", "accent", "status", "other"];
    expect(roles).toHaveLength(6);
  });

  it("TypoRole covers the fixed enum", () => {
    const roles: TypoRole[] = ["heading", "body", "caption", "code", "other"];
    expect(roles).toHaveLength(5);
  });

  it("SynthesizedSections has all seven output groups", () => {
    const s: SynthesizedSections = {
      identity: "x",
      colors: { entries: [], warnings: [] },
      typography: { entries: [], warnings: [] },
      spacing: { scale: [] },
      radii: { scale: [] },
      shadows: { items: [] },
      components: [],
      warnings: [],
    };
    expect(Object.keys(s)).toEqual([
      "identity", "colors", "typography", "spacing", "radii", "shadows", "components", "warnings",
    ]);
  });

  it("SystemIngestOutcome discriminates ok/failure", () => {
    const ok: SystemIngestOutcome = {
      ok: true,
      source: { fileKey: "f", scannedAt: "2026-05-11T00:00:00Z" },
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
    const fail: SystemIngestOutcome = { ok: false, reason: "x" };
    expect(ok.ok).toBe(true);
    expect(fail.ok).toBe(false);
  });
});
