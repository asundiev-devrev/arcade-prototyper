import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";

const LIST_FRAME = `
import { VistaPage, VistaFilterPill, VistaPagination } from "arcade-prototypes";
import { Button } from "arcade";

export default function Frame() {
  return <VistaPage title="Tickets" />;
}
`;

describe("buildManifest", () => {
  it("assembles a manifest for a list-view frame", () => {
    const m = buildManifest({
      projectSlug: "p",
      frameSlug: "tickets",
      frameAbsPath: "/abs/path/index.tsx",
      frameSource: LIST_FRAME,
      intentSummary: "List of all tickets.",
      figmaUrl: undefined,
      screenshotUrl: undefined,
    });

    expect(m.projectSlug).toBe("p");
    expect(m.frameSlug).toBe("tickets");
    expect(m.shape).toBe("list-view");
    expect(m.imports.map((i) => i.source).sort()).toEqual([
      "arcade",
      "arcade-prototypes",
    ]);
    expect(m.mappings.length).toBeGreaterThan(0);
    expect(m.schemaVersion).toBe(1);
  });

  it("populates unmapped[] for imports with no mapping entry", () => {
    const src = `import { TotallyMadeUpComponent } from "arcade";`;
    const m = buildManifest({
      projectSlug: "p",
      frameSlug: "f",
      frameAbsPath: "/x/index.tsx",
      frameSource: src,
      intentSummary: "",
    });
    expect(m.unmapped).toEqual([
      { source: "arcade", name: "TotallyMadeUpComponent" },
    ]);
  });

  it("uses ad-hoc shape when no prototype-kit template is imported", () => {
    const src = `import { Button } from "arcade";`;
    const m = buildManifest({
      projectSlug: "p",
      frameSlug: "f",
      frameAbsPath: "/x/index.tsx",
      frameSource: src,
      intentSummary: "",
    });
    expect(m.shape).toBe("ad-hoc");
  });
});
