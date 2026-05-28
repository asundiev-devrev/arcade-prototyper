// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Static guard: the Stop button glyph went invisible at 0.23.2 because the
// fill + glyph used the `neutral-medium` / `neutral-prominent` pair, which
// collapse to the same hue inside a single theme. The fix is to use the
// `neutral-prominent` fill with the `neutral-on-prominent` glyph so the
// contrast is guaranteed in both light and dark mode. Pin those two token
// names so a casual edit can't regress the contrast again.
const file = path.resolve(
  __dirname,
  "../../prototype-kit/composites/ChatInput.tsx",
);

describe("ChatInput.StopButton tokens", () => {
  it("paints the fill with --bg-neutral-prominent and the glyph with --fg-neutral-on-prominent", () => {
    const src = fs.readFileSync(file, "utf8");
    // Slice from the StopButton declaration down to the closing brace so we
    // do not accidentally match the SendButton or other unrelated buttons.
    const start = src.indexOf("function StopButton");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n}", start);
    const slice = src.slice(start, end);

    expect(slice).toContain("bg-(--bg-neutral-prominent)");
    expect(slice).toContain("text-(--fg-neutral-on-prominent)");
    // Negative guard: the broken pair must not reappear together. (We allow
    // either token elsewhere — this only fails when both are present in the
    // StopButton, which is exactly the regression we are pinning against.)
    const hadMedium = /bg-\(--bg-neutral-medium\)/.test(slice);
    const hadProminentText = /text-\(--fg-neutral-prominent\)/.test(slice);
    expect(hadMedium && hadProminentText).toBe(false);
  });
});
