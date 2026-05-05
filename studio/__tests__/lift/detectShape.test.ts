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

  it("returns settings-form when the frame imports SettingsPage", () => {
    const imports: FrameImport[] = [
      { source: "arcade-prototypes", names: ["SettingsPage"] },
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
