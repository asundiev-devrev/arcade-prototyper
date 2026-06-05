import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "../../templates/CLAUDE.md.tpl");

describe("CLAUDE.md template — design system section", () => {
  it("contains the `## Design system` heading", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    expect(tpl).toMatch(/^## Design system$/m);
  });

  it("contains the literal `@DESIGN.md` import line", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    expect(tpl).toMatch(/^@DESIGN\.md$/m);
  });

  it("places the Design system section before the four-rules section", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    const designIdx = tpl.indexOf("## Design system");
    const rulesIdx = tpl.indexOf("R1. Figma is the source of truth");
    expect(designIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(designIdx).toBeLessThan(rulesIdx);
  });
});

describe("CLAUDE.md template — kit manifest lives in the system prompt, not the file", () => {
  it("does NOT @-import the manifest (it's injected via --append-system-prompt for cache reuse)", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    // A CLAUDE.md @-import lands AFTER the CLI cache breakpoint and re-creates
    // on every round-trip. The manifest must NOT be imported here; it is
    // passed via --append-system-prompt (see server/claudeCode.ts) so it sits
    // in the cached region.
    expect(tpl).not.toMatch(/^@.*KIT-MANIFEST\.md$/m);
  });

  it("tells the agent the manifest is already in its system prompt", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    expect(tpl).toMatch(/system prompt/i);
    expect(tpl).toMatch(/do NOT.*Read it|already in front of you|wasted latency/i);
  });

  it("no longer instructs the agent to `Read … KIT-MANIFEST.md`", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    expect(tpl).not.toMatch(/Read\s+\{\{PROTOTYPER\}\}\/studio\/prototype-kit\/KIT-MANIFEST\.md/);
  });
});

describe("CLAUDE.md template — DevRev API split out", () => {
  it("points at shared/DEVREV-API.md instead of inlining the integration guide", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    expect(tpl).toMatch(/Read shared\/DEVREV-API\.md/);
  });

  it("does not inline the heavy internal-endpoint docs in the always-loaded template", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    // A representative deep-detail string that used to live inline and now
    // belongs only in the on-demand reference file.
    expect(tpl).not.toContain("custom_fields.tnt__sprint_group");
  });
});
