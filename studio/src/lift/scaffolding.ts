// studio/src/lift/scaffolding.ts
//
// Per-shape production scaffolding checklist. Items describe the work a
// Studio frame never covers by itself (data layer, adapters, routing, flags,
// telemetry) and point at devrev-web's conventional paths.
//
// Path patterns use <domain> and <Entity> as placeholders. They are
// surfaced verbatim in the markdown manifest — the engineer fills them in.

import type { FrameShape, ScaffoldingItem } from "./types";

const ITEM_DATA_HOOK: ScaffoldingItem = {
  label: "Data-layer hook (useDL<Entity> query)",
  pathPattern: "libs/<domain>/shared/data-layer/src/use-<entity>.ts",
  status: "required",
};

const ITEM_DATA_MUTATION_HOOK: ScaffoldingItem = {
  label: "Data-layer hook (useDL<Entity> mutation)",
  pathPattern: "libs/<domain>/shared/data-layer/src/use-update-<entity>.ts",
  status: "required",
};

const ITEM_LIST_HOOK: ScaffoldingItem = {
  label: "Data-layer hook (useDL<Entity>s list query)",
  pathPattern: "libs/<domain>/shared/data-layer/src/use-<entity>s.ts",
  status: "required",
};

const ITEM_ADAPTER: ScaffoldingItem = {
  label: "Adapter (API response → UI shape)",
  pathPattern: "libs/<domain>/adapters/src/<entity>.ts",
  status: "required",
};

const ITEM_ADAPTER_LIST: ScaffoldingItem = {
  label: "Adapter (API list response → UI shape)",
  pathPattern: "libs/<domain>/adapters/src/<entity>-list.ts",
  status: "required",
};

const ITEM_QUERY_KEYS: ScaffoldingItem = {
  label: "Query keys entry",
  pathPattern: "libs/<domain>/shared/data-layer/src/keys.ts",
  status: "required",
};

const ITEM_STALE_TIME: ScaffoldingItem = {
  label: "Stale time entry",
  pathPattern: "STALE_TIMES_IN_MS.<ENTITY>",
  status: "required",
};

const ITEM_FORM_HOOK: ScaffoldingItem = {
  label: "Form hook (validation + submission)",
  pathPattern: "libs/<domain>/feature/<feature>/src/hooks/use-<feature>-form.ts",
  status: "required",
};

const ITEM_ROUTE: ScaffoldingItem = {
  label: "Route registration",
  pathPattern: "apps/product/dr-router.tsx + libs/micro-apps/main/src/...",
  status: "required",
};

const ITEM_FEATURE_FLAG: ScaffoldingItem = {
  label: "Feature flag gate (useFeatureFlag)",
  status: "required",
};

const ITEM_TELEMETRY: ScaffoldingItem = {
  label: "Event tracker wiring (useEventTracker + track)",
  status: "required",
};

const ITEM_TEMPLATE_CHOICE: ScaffoldingItem = {
  label:
    "Consider whether this fits an existing Tier-2/3 template (PageLayout, ListViewPage, SettingsPage)",
  status: "required",
};

export function scaffoldingFor(shape: FrameShape): ScaffoldingItem[] {
  switch (shape) {
    case "list-view":
      return [
        ITEM_LIST_HOOK,
        ITEM_ADAPTER_LIST,
        ITEM_QUERY_KEYS,
        ITEM_STALE_TIME,
        ITEM_ROUTE,
        ITEM_FEATURE_FLAG,
        ITEM_TELEMETRY,
      ];
    case "settings-form":
      return [
        ITEM_DATA_HOOK,
        ITEM_DATA_MUTATION_HOOK,
        ITEM_ADAPTER,
        ITEM_QUERY_KEYS,
        ITEM_STALE_TIME,
        ITEM_FORM_HOOK,
        ITEM_ROUTE,
        ITEM_FEATURE_FLAG,
        ITEM_TELEMETRY,
      ];
    case "settings-list":
      // A settings page that displays a list (e.g. skills gallery) reads
      // data but doesn't author it. No mutation hook, no form hook —
      // those would be checklist noise the engineer has to cross off.
      return [
        ITEM_LIST_HOOK,
        ITEM_ADAPTER_LIST,
        ITEM_QUERY_KEYS,
        ITEM_STALE_TIME,
        ITEM_ROUTE,
        ITEM_FEATURE_FLAG,
        ITEM_TELEMETRY,
      ];
    case "detail":
      return [
        ITEM_DATA_HOOK,
        ITEM_ADAPTER,
        ITEM_QUERY_KEYS,
        ITEM_STALE_TIME,
        ITEM_ROUTE,
        ITEM_FEATURE_FLAG,
        ITEM_TELEMETRY,
      ];
    case "ad-hoc":
      return [
        ITEM_TEMPLATE_CHOICE,
        ITEM_DATA_HOOK,
        ITEM_ADAPTER,
        ITEM_QUERY_KEYS,
        ITEM_STALE_TIME,
        ITEM_ROUTE,
        ITEM_FEATURE_FLAG,
        ITEM_TELEMETRY,
      ];
  }
}
