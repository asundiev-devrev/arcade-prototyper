// studio/server/expand/registry.ts
import { expandSettingsPage } from "../../prototype-kit/templates/SettingsPage";

export const FULL_PAGE_TAGS = ["SettingsPage", "ComputerPage", "VistaPage", "BuilderPage"];

export function authoredExpand(tag: string): ((props: Record<string, string>) => string) | null {
  if (tag === "SettingsPage") return expandSettingsPage;
  return null; // ComputerPage / VistaPage / BuilderPage → AI fallback (not yet authored)
}
