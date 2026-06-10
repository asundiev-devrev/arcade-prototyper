// studio/__tests__/lift/conventions.test.ts
//
// Guards for which conventions apply to which frames. The conventions
// architecture trusts the agent to DO the right translation; the tests
// only verify that the right convention blocks are surfaced to it.

import { describe, it, expect } from "vitest";
import {
  APP_SCOPED_TOKEN_CONVENTION,
  applicableConventions,
  CHROME_CONVENTION,
  DEFAULT_MAPPING_CONVENTION,
  hasOverlayMarkup,
  ICON_CONVENTION,
  OVERLAY_CONVENTION,
  STYLE_ATTRIBUTE_CONVENTION,
} from "../../src/lift/conventions";

describe("applicableConventions", () => {
  it("always emits the default_mapping_convention", () => {
    const conventions = applicableConventions({
      hasIcons: false,
      importedNames: [],
    });
    expect(conventions).toContain(DEFAULT_MAPPING_CONVENTION);
  });

  it("emits icon_convention when any icon import is present", () => {
    const conventions = applicableConventions({
      hasIcons: true,
      importedNames: ["Button"],
    });
    expect(conventions).toContain(ICON_CONVENTION);
  });

  it("omits icon_convention when the frame has no icons", () => {
    const conventions = applicableConventions({
      hasIcons: false,
      importedNames: ["Button", "Input"],
    });
    expect(conventions).not.toContain(ICON_CONVENTION);
  });

  it("emits chrome_convention when NavSidebar or similar is imported", () => {
    const withNav = applicableConventions({
      hasIcons: false,
      importedNames: ["NavSidebar", "SettingsPage"],
    });
    expect(withNav).toContain(CHROME_CONVENTION);

    const withAppShell = applicableConventions({
      hasIcons: false,
      importedNames: ["AppShell"],
    });
    expect(withAppShell).toContain(CHROME_CONVENTION);
  });

  it("omits chrome_convention when the frame has no chrome primitives", () => {
    const conventions = applicableConventions({
      hasIcons: false,
      importedNames: ["SettingsPage", "Button", "Input"],
    });
    expect(conventions).not.toContain(CHROME_CONVENTION);
  });

  it("icon_convention lookup addresses the `color` prop explicitly", () => {
    // Regression guard: two live-lift runs on 2026-05-12 dropped `color`
    // silently because the convention didn't mention it. This test ensures
    // the guidance stays in the convention text.
    expect(ICON_CONVENTION.lookup).toMatch(/\bcolor\b/i);
    expect(ICON_CONVENTION.lookup).toMatch(/currentColor|inherit/);
  });

  it("emits overlay_convention when hasOverlay is true", () => {
    const c = applicableConventions({
      hasIcons: false,
      importedNames: [],
      hasOverlay: true,
    });
    expect(c).toContain(OVERLAY_CONVENTION);
  });

  it("omits overlay_convention by default", () => {
    const c = applicableConventions({ hasIcons: false, importedNames: [] });
    expect(c).not.toContain(OVERLAY_CONVENTION);
  });

  it("style_attribute_convention warns that utilities are auto-generated, not hand-listed", () => {
    // Regression guard: a live lift false-flagged bg-surface-shallow as "not
    // a real utility" because it wasn't hand-listed in the Tailwind config,
    // then "fixed" a working class. The convention must teach that
    // devrev-web auto-generates bg-*/border-*/fg-* from CSS vars, so config
    // absence != not-a-utility, and the live render is the only authority.
    expect(STYLE_ATTRIBUTE_CONVENTION.lookup).toMatch(/auto-generate/i);
    expect(STYLE_ATTRIBUTE_CONVENTION.lookup).toMatch(/dark-styles\.css/);
    expect(STYLE_ATTRIBUTE_CONVENTION.lookup).toMatch(/not.*mean.*not a utility/i);
    // The surface-shallow anchor documents the exact false-positive.
    expect(STYLE_ATTRIBUTE_CONVENTION.anchors.join("\n")).toMatch(/bg-surface-shallow/);
  });

  it("emits app_scoped_token_convention when ChatBubble is imported", () => {
    const c = applicableConventions({
      hasIcons: false,
      importedNames: ["ChatBubble", "Button"],
    });
    expect(c).toContain(APP_SCOPED_TOKEN_CONVENTION);
  });

  it("omits app_scoped_token_convention when no app-scoped primitive is present", () => {
    const c = applicableConventions({
      hasIcons: false,
      importedNames: ["Button", "Input"],
    });
    expect(c).not.toContain(APP_SCOPED_TOKEN_CONVENTION);
  });

  it("app_scoped_token_convention names the user-bubble tokens and the defining app shells", () => {
    // Regression guard: the live 01-chat-with-canvas lift shipped a
    // transparent sender bubble because the agent grepped instead of
    // rendering. The convention must call out the exact tokens AND that
    // grep can't catch this.
    expect(APP_SCOPED_TOKEN_CONVENTION.rule).toMatch(/user-bubble-primary/);
    expect(APP_SCOPED_TOKEN_CONVENTION.rule).toMatch(/grep/i);
    expect(APP_SCOPED_TOKEN_CONVENTION.lookup).toMatch(/portal-shell/);
    expect(APP_SCOPED_TOKEN_CONVENTION.lookup).toMatch(/plug-widget/);
    expect(APP_SCOPED_TOKEN_CONVENTION.lookup).toMatch(/bg-menu-selected/);
  });

  it("puts icon_convention first and default_mapping_convention last", () => {
    // The renderer emits conventions in array order; the order below is a
    // deliberate pedagogical choice: teach the narrow rules (icons, chrome)
    // before the fallback rule (default mapping).
    const conventions = applicableConventions({
      hasIcons: true,
      importedNames: ["NavSidebar"],
    });
    expect(conventions[0]).toBe(ICON_CONVENTION);
    expect(conventions[conventions.length - 1]).toBe(DEFAULT_MAPPING_CONVENTION);
  });
});

describe("hasOverlayMarkup", () => {
  it("matches double-quoted classNames with fixed + inset-0", () => {
    expect(
      hasOverlayMarkup(
        `<div className="fixed inset-0 z-50 flex items-center justify-center p-4">`,
      ),
    ).toBe(true);
  });

  it("matches single-quoted classNames", () => {
    expect(
      hasOverlayMarkup(
        `<div className='fixed inset-0 z-50'>`,
      ),
    ).toBe(true);
  });

  it("matches even when the order is reversed (inset-0 before fixed)", () => {
    expect(
      hasOverlayMarkup(`<div className="inset-0 fixed z-50">`),
    ).toBe(true);
  });

  it("does NOT match when only one of the tokens is present", () => {
    expect(hasOverlayMarkup(`<div className="fixed top-4 right-4">`)).toBe(false);
    expect(hasOverlayMarkup(`<div className="absolute inset-0">`)).toBe(false);
  });

  it("does NOT match on unrelated tailwind utilities", () => {
    expect(
      hasOverlayMarkup(
        `<div className="flex flex-col gap-6 py-2 rounded-lg">`,
      ),
    ).toBe(false);
  });
});
