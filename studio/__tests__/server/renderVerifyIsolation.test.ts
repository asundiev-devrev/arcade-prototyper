// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  SYNTHETIC_ENTRY,
  resolveTargetPage,
  RENDER_VERIFY_CORRECTIVE_PROMPT,
} from "../../server/renderVerifyIsolation";

describe("SYNTHETIC_ENTRY", () => {
  it("renders the target page directly, ext stripped, subdir kept", () => {
    const e = SYNTHETIC_ENTRY("pages/Preferences.tsx");
    expect(e).toContain('from "./pages/Preferences"');
    expect(e).not.toContain(".tsx");
    expect(e).toMatch(/export default \(\) => </);
  });
  it("handles a top-level index.tsx target", () => {
    expect(SYNTHETIC_ENTRY("index.tsx")).toContain('from "./index"');
  });
});

describe("resolveTargetPage", () => {
  it("picks the first pages/*.tsx", () => {
    expect(resolveTargetPage(["frames/01/pages/Preferences.tsx", "frames/01/index.tsx"]))
      .toBe("pages/Preferences.tsx");
  });
  it("falls back to index.tsx when no page changed", () => {
    expect(resolveTargetPage(["frames/01/index.tsx"])).toBe("index.tsx");
  });
  it("null when nothing frame-relevant changed", () => {
    expect(resolveTargetPage(["shared/devrev.ts"])).toBeNull();
    expect(resolveTargetPage([])).toBeNull();
  });
});

describe("corrective prompt", () => {
  it("is component-agnostic + says never-report-false", () => {
    expect(RENDER_VERIFY_CORRECTIVE_PROMPT).toMatch(/did ?n['’]?t (render|alter)|identical/i);
    expect(RENDER_VERIFY_CORRECTIVE_PROMPT).toMatch(/ignored|another way|different/i);
    expect(RENDER_VERIFY_CORRECTIVE_PROMPT).toMatch(/never (report|claim)/i);
  });
});
