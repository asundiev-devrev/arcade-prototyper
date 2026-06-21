// __tests__/extension/panel-csp.test.ts
import { describe, it, expect } from "vitest";
import { buildPanelHtml } from "../../../extension/src/panel";

describe("buildPanelHtml", () => {
  const html = buildPanelHtml("http://localhost:51234", "testnonce123");

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
  it("relays clipboard paste to the iframe (Cmd+V bridge) under a nonce", () => {
    // The extension posts {type:'arcade:paste'} on Cmd+V; the panel script
    // forwards it into the iframe. The inline relay runs under a CSP nonce
    // (the VS Code-recommended pattern), not 'unsafe-inline'.
    expect(html).toMatch(/script-src 'nonce-testnonce123'/);
    expect(html).toContain('<script nonce="testnonce123">');
    expect(html).not.toMatch(/script-src 'unsafe-inline'/);
    expect(html).toContain("arcade:paste");
    expect(html).toContain("contentWindow.postMessage");
  });
  it("pins scale to 100% so the editor zoom level doesn't enlarge content", () => {
    expect(html).toMatch(/viewport[^>]*initial-scale=1\.0/);
  });
});
