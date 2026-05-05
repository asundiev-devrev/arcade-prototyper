import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderMarkdown } from "../../src/lift/render";

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
  return renderMarkdown(manifest);
}

describe("renderMarkdown", () => {
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
  // have production.source === "n/a". They must appear in the inventory table
  // as "_no direct equivalent_" but MUST NOT render a "### X → n/a" block in
  // the Composite mapping details section (which would just restate the
  // inventory row's judgment note under a misleading heading).
  it("skips n/a composites in the details section", () => {
    const rendered = snap("computer-frame.tsx", "Computer app chrome.");
    expect(rendered).toContain("_no direct equivalent_");
    expect(rendered).not.toContain("→ n/a");
    expect(rendered).toMatchSnapshot();
  });
});
