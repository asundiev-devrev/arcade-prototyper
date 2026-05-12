import { describe, it, expect } from "vitest";
import { scaffoldingFor } from "../../src/lift/scaffolding";

describe("scaffoldingFor", () => {
  it("list-view includes data hook, query keys, route, feature flag, telemetry", () => {
    const items = scaffoldingFor("list-view");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Data-layer hook (useDL<Entity>s list query)");
    expect(labels).toContain("Query keys entry");
    expect(labels).toContain("Stale time entry");
    expect(labels).toContain("Adapter (API list response → UI shape)");
    expect(labels).toContain("Route registration");
    expect(labels).toContain("Feature flag gate (useFeatureFlag)");
    expect(labels).toContain("Event tracker wiring (useEventTracker + track)");
  });

  it("settings-form includes form hook, mutation hook, and the scaffolding that settings skip", () => {
    const items = scaffoldingFor("settings-form");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Data-layer hook (useDL<Entity> mutation)");
    expect(labels).toContain("Form hook (validation + submission)");
    // Settings forms typically don't paginate.
    expect(items.find((i) => i.label === "Query keys entry")?.status).toBe("required");
  });

  it("settings-list includes list-query scaffolding without mutation or form hooks", () => {
    // A settings page that displays a list reads data but doesn't author
    // it. The checklist should reflect that — mutation + form hooks would
    // be cross-off noise for a skills gallery or similar.
    const items = scaffoldingFor("settings-list");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Data-layer hook (useDL<Entity>s list query)");
    expect(labels).toContain("Adapter (API list response → UI shape)");
    expect(labels).not.toContain("Data-layer hook (useDL<Entity> mutation)");
    expect(labels).not.toContain("Form hook (validation + submission)");
  });

  it("ad-hoc surfaces the generic checklist with a 'consider a template' note item", () => {
    const items = scaffoldingFor("ad-hoc");
    const labels = items.map((i) => i.label);
    expect(labels).toContain(
      "Consider whether this fits an existing Tier-2/3 template (PageLayout, ListViewPage, SettingsPage)",
    );
  });

  it("every item has a status of required or n/a", () => {
    for (const shape of [
      "list-view",
      "settings-form",
      "settings-list",
      "detail",
      "ad-hoc",
    ] as const) {
      for (const item of scaffoldingFor(shape)) {
        expect(["required", "n/a", "done"]).toContain(item.status);
      }
    }
  });
});
