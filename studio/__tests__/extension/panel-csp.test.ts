// __tests__/extension/panel-csp.test.ts
import { describe, it, expect } from "vitest";
import { buildPanelHtml } from "../../../extension/src/panel";

describe("buildPanelHtml", () => {
  const html = buildPanelHtml("http://localhost:51234");

  it("embeds the localhost server in an iframe", () => {
    expect(html).toContain('<iframe');
    expect(html).toContain('src="http://localhost:51234"');
  });
  it("allows framing localhost + ws for HMR, and nothing wider", () => {
    expect(html).toMatch(/frame-src http:\/\/localhost:\*/);
    expect(html).toMatch(/connect-src[^;]*ws:\/\/localhost:\*/);
    // No wildcard host that would let arbitrary remote content frame in.
    expect(html).not.toMatch(/frame-src[^;]*\shttps?:\/\/\*[\s;]/);
  });
});
