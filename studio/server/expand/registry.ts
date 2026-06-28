// studio/server/expand/registry.ts
// Import the authored expander from the IMPORT-FREE sibling, NOT the React
// template (SettingsPage.tsx), whose composite imports pull the
// @xorkavi/arcade-gen barrel → gridstack — which crashes vite.config.ts at load
// (gridstack's extensionless ESM subpath import only a bundler can resolve).
// This module is in vite.config's static graph via chat.ts's post-gen hook, so
// the chain must stay barrel-free. See SettingsPage.expand.ts.
import { expandSettingsPage } from "../../prototype-kit/templates/SettingsPage.expand";

export const FULL_PAGE_TAGS = ["SettingsPage", "ComputerPage", "VistaPage", "BuilderPage"];

export function authoredExpand(tag: string): ((props: Record<string, string>) => string) | null {
  if (tag === "SettingsPage") return expandSettingsPage;
  return null; // ComputerPage / VistaPage / BuilderPage → AI fallback (not yet authored)
}
