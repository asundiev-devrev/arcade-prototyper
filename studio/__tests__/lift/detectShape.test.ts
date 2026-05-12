import { describe, it, expect } from "vitest";
import { detectShape } from "../../src/lift/detectShape";
import type { FrameImport } from "../../src/lift/types";

describe("detectShape", () => {
  it("returns list-view when the frame imports VistaPage", () => {
    const imports: FrameImport[] = [
      { source: "arcade-prototypes", names: ["VistaPage"] },
    ];
    expect(detectShape(imports)).toBe("list-view");
  });

  it("returns settings-form when SettingsPage is paired with form inputs", () => {
    const imports: FrameImport[] = [
      { source: "arcade-prototypes", names: ["SettingsPage", "SettingsCard"] },
      { source: "arcade", names: ["Input", "Checkbox", "Button"] },
    ];
    expect(detectShape(imports)).toBe("settings-form");
  });

  it("returns settings-list when SettingsPage has no form inputs", () => {
    // A gallery-style settings page (e.g. skills gallery): SettingsPage +
    // Tabs + cards, but no Input/Select/Checkbox/TextArea. Uses list-query
    // scaffolding, not form-submission scaffolding.
    const imports: FrameImport[] = [
      { source: "arcade-prototypes", names: ["SettingsPage", "NavSidebar"] },
      { source: "arcade", names: ["Button", "Tabs", "Tag", "Avatar"] },
    ];
    expect(detectShape(imports)).toBe("settings-list");
  });

  it("treats a lone Switch as a list toggle, not a form signal", () => {
    // Regression guard for the real skills-modal frame, which adds a Switch
    // per card to enable/disable. That's list UI, not form authoring.
    const imports: FrameImport[] = [
      { source: "arcade-prototypes", names: ["SettingsPage"] },
      { source: "arcade", names: ["Switch", "Button"] },
    ];
    expect(detectShape(imports)).toBe("settings-list");
  });

  it("picks up form inputs from arcade/components too", () => {
    // Defensive: parseImports normalizes arcade/components → arcade today,
    // but the detection should work either way.
    const imports: FrameImport[] = [
      { source: "arcade-prototypes", names: ["SettingsPage"] },
      { source: "arcade/components", names: ["TextArea"] },
    ];
    expect(detectShape(imports)).toBe("settings-form");
  });

  it("returns detail when the frame uses TitleBar + BreadcrumbBar + PageBody but no template", () => {
    const imports: FrameImport[] = [
      {
        source: "arcade-prototypes",
        names: ["AppShell", "TitleBar", "BreadcrumbBar", "PageBody"],
      },
    ];
    expect(detectShape(imports)).toBe("detail");
  });

  it("returns ad-hoc when no known shape markers are present", () => {
    const imports: FrameImport[] = [
      { source: "arcade", names: ["Button", "Input"] },
    ];
    expect(detectShape(imports)).toBe("ad-hoc");
  });

  it("prefers the most specific marker when multiple could match", () => {
    // VistaPage beats TitleBar+BreadcrumbBar.
    const imports: FrameImport[] = [
      {
        source: "arcade-prototypes",
        names: ["VistaPage", "TitleBar", "BreadcrumbBar"],
      },
    ];
    expect(detectShape(imports)).toBe("list-view");
  });
});
