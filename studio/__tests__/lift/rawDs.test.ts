// @vitest-environment node
import { describe, it, expect } from "vitest";
import { rawDs, kebab } from "../../src/lift/mappings/rawDs";

describe("kebab", () => {
  it("converts PascalCase to kebab-case", () => {
    expect(kebab("Button")).toBe("button");
    expect(kebab("IconButton")).toBe("icon-button");
    expect(kebab("TextInput")).toBe("text-input");
    expect(kebab("SingleSelect")).toBe("single-select");
    expect(kebab("ChatBubble")).toBe("chat-bubble");
    expect(kebab("ThemeProvider")).toBe("theme-provider");
  });
});

describe("rawDs", () => {
  it("builds the per-component subpath import (not a bare barrel)", () => {
    expect(rawDs("Button")).toBe(
      "@devrev-web-internal/design-system-shared-raw-design-system/components/button",
    );
    expect(rawDs("IconButton")).toBe(
      "@devrev-web-internal/design-system-shared-raw-design-system/components/icon-button",
    );
    expect(rawDs("SingleSelect")).toBe(
      "@devrev-web-internal/design-system-shared-raw-design-system/components/single-select",
    );
  });

  it("never emits the stale bare-barrel path", () => {
    // Regression: the old constant '@devrev-web/design-system/shared/
    // raw-design-system' resolved nowhere — every component must use the
    // /components/<kebab> subpath instead.
    expect(rawDs("Button")).not.toContain("design-system/shared/raw-design-system");
    expect(rawDs("Page")).toContain("/components/page");
  });
});
