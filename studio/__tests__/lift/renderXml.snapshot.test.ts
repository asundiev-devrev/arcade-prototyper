import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderXml } from "../../src/lift/render";

const FIXTURES = path.join(__dirname, "fixtures");

function snap(name: string, intent: string) {
  const source = fs.readFileSync(path.join(FIXTURES, name), "utf-8");
  const manifest = buildManifest({
    projectSlug: "demo",
    frameSlug: name.replace(".tsx", ""),
    frameAbsPath: `/abs/${name}`,
    frameSource: source,
    intentSummary: intent,
    figmaUrl: "https://figma.com/file/xyz",
    screenshotUrl: "/api/projects/demo/thumbnails/" + name.replace(".tsx", "") + ".png",
  });
  return renderXml(manifest);
}

describe("renderXml", () => {
  it("renders a list-view frame", () => {
    expect(snap("list-frame.tsx", "List of tickets with filters and pagination.")).toMatchSnapshot();
  });

  it("renders a settings-form frame", () => {
    expect(snap("settings-frame.tsx", "Profile settings form.")).toMatchSnapshot();
  });

  it("renders a detail frame", () => {
    expect(snap("detail-frame.tsx", "Ticket detail with tabs.")).toMatchSnapshot();
  });

  it("renders an ad-hoc frame", () => {
    expect(snap("adhoc-frame.tsx", "Confirmation modal.")).toMatchSnapshot();
  });

  // Regression guard: Studio-only composites (ComputerHeader, ChatInput, etc.)
  // have production.source === "n/a". They appear in the inventory as a
  // mapping with equivalent="none" — no production_source / production_name
  // attributes, and no separate details section to restate the same info
  // under a misleading heading.
  it(`marks n/a composites with equivalent="none"`, () => {
    const rendered = snap("computer-frame.tsx", "Computer app chrome.");
    expect(rendered).toContain(`equivalent="none"`);
    expect(rendered).not.toContain(`production_name="n/a"`);
    expect(rendered).toMatchSnapshot();
  });

  // Well-formedness sanity check — every real lift has to parse as XML to be
  // useful in a Claude Code context. Minimal structural guard: exactly one
  // opening and one closing lift_manifest tag.
  it("produces a single well-formed lift_manifest root element", () => {
    const rendered = snap("list-frame.tsx", "x");
    const open = rendered.match(/<lift_manifest [^>]+>/g) ?? [];
    const close = rendered.match(/<\/lift_manifest>/g) ?? [];
    expect(open).toHaveLength(1);
    expect(close).toHaveLength(1);
  });
});
