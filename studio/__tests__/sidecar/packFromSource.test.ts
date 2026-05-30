// @vitest-environment node
import { describe, it, expect } from "vitest";
import { packFromSource } from "../../server/sidecar/packFromSource";

describe("packFromSource", () => {
  it("packs a tsx string into one self-contained html", async () => {
    const tsx = `import * as React from "react";
import { Button } from "arcade/components";
export default function Frame() { return <Button variant="primary">Hi</Button>; }`;
    const html = await packFromSource({ tsx, mode: "light" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<div id="root">');
    // css + js inlined, not linked
    expect(html).toMatch(/<style>[\s\S]+<\/style>/);
    expect(html).toMatch(/<script type="module">[\s\S]+<\/script>/);
    expect(html).not.toContain("/assets/bundle.js"); // self-contained, no external refs
  }, 120_000);
});
