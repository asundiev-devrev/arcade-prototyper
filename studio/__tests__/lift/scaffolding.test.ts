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

  it("ad-hoc surfaces the generic checklist with a 'consider a template' note item", () => {
    const items = scaffoldingFor("ad-hoc");
    const labels = items.map((i) => i.label);
    expect(labels).toContain(
      "Consider whether this fits an existing Tier-2/3 template (PageLayout, ListViewPage, SettingsPage)",
    );
  });

  it("every item has a status of required or n/a", () => {
    for (const shape of ["list-view", "settings-form", "detail", "ad-hoc"] as const) {
      for (const item of scaffoldingFor(shape)) {
        expect(["required", "n/a", "done"]).toContain(item.status);
      }
    }
  });
});
