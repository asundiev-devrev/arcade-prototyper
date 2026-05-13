// studio/__tests__/lift/styleAttributeConvention.test.ts
//
// Guards for the style_attribute_convention added 2026-05-13 after a
// render loop caught inline `style={{ ... var(--X) ... }}` references
// silently falling through to Tailwind's `currentColor` default
// (near-black borders, transparent backgrounds).

import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderXml } from "../../src/lift/render";
import {
  hasInlineStyleTokens,
  STYLE_ATTRIBUTE_CONVENTION,
} from "../../src/lift/conventions";

describe("hasInlineStyleTokens detector", () => {
  it("fires when a frame uses style={{}} with a --bg-* token", () => {
    const src = `<div style={{ background: 'var(--bg-surface-overlay)' }}/>`;
    expect(hasInlineStyleTokens(src)).toBe(true);
  });

  it("fires for --fg-*, --stroke-*, --border-*, --color-*", () => {
    for (const token of [
      "--fg-neutral-prominent",
      "--stroke-neutral-subtle",
      "--border-outline-00",
      "--color-neutral-subtle",
    ]) {
      expect(
        hasInlineStyleTokens(`<div style={{ color: 'var(${token})' }}/>`),
        token,
      ).toBe(true);
    }
  });

  it("does NOT fire for bracket arbitrary-value classNames", () => {
    // Explicit regression guard: the class `border-[hsl(var(--X))]` is
    // the CORRECT form — it must not trigger the convention that would
    // tell the agent to rewrite it.
    const src = `<div className="border border-[hsl(var(--stroke-neutral-subtle))]"/>`;
    expect(hasInlineStyleTokens(src)).toBe(false);
  });

  it("does NOT fire for inline style with non-theme var(--X)", () => {
    // Some app-local CSS vars are fine inline (no theme indirection).
    const src = `<div style={{ padding: 'var(--local-padding)' }}/>`;
    expect(hasInlineStyleTokens(src)).toBe(false);
  });

  it("does NOT fire when frame has no inline style at all", () => {
    const src = `<div className="bg-surface-overlay"/>`;
    expect(hasInlineStyleTokens(src)).toBe(false);
  });
});

describe("style_attribute_convention rendering", () => {
  const frameWithInlineTokens = `
    import * as React from "react";
    export default function F() {
      return <div style={{ background: 'var(--bg-surface-overlay)' }}>hi</div>;
    }
  `;

  const frameWithoutInlineTokens = `
    import { Button } from "arcade/components";
    export default function F() {
      return <Button>hi</Button>;
    }
  `;

  it("emits <style_attribute_convention> when the frame has inline theme tokens", () => {
    const xml = renderXml(
      buildManifest({
        projectSlug: "p",
        frameSlug: "f",
        frameAbsPath: "/f",
        frameSource: frameWithInlineTokens,
        intentSummary: "",
      }),
    );
    expect(xml).toContain("<style_attribute_convention>");
  });

  it("does NOT emit the convention when the frame has no inline theme tokens", () => {
    const xml = renderXml(
      buildManifest({
        projectSlug: "p",
        frameSlug: "f",
        frameAbsPath: "/f",
        frameSource: frameWithoutInlineTokens,
        intentSummary: "",
      }),
    );
    expect(xml).not.toContain("<style_attribute_convention>");
  });
});

describe("style_attribute_convention anchor coverage", () => {
  it("anchors include both backgrounds and borders", () => {
    const joined = STYLE_ATTRIBUTE_CONVENTION.anchors.join("\n");
    expect(joined).toMatch(/background/i);
    expect(joined).toMatch(/borderColor/i);
  });

  it("prescribes the bracket arbitrary-value form for borders", () => {
    // The render loop proved `border-neutral-subtle` Tailwind utilities
    // are unreliable because of nested hsl() wrapping. The convention
    // must tell the agent to fall back to the arbitrary-value form.
    const joined = STYLE_ATTRIBUTE_CONVENTION.anchors.join("\n");
    expect(joined).toMatch(/\[hsl\(var\(--[a-z0-9-]+\)\)\]/);
  });
});
