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
});
