import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATE_SEEDS_DIR = path.resolve(STUDIO_DIR, "prototype-kit", "template-seeds");
export const TEMPLATE_THUMBS_DIR = path.resolve(STUDIO_DIR, "prototype-kit", "template-thumbs");

export type TemplateId = "computer" | "settings-page" | "app-list";

export interface TemplateDef {
  id: TemplateId;
  name: string;
  description: string;
  seedFile: string; // basename under TEMPLATE_SEEDS_DIR
  thumb: string;     // basename under TEMPLATE_THUMBS_DIR
}

export const TEMPLATES: TemplateDef[] = [
  { id: "computer", name: "Computer", description: "Agent chat screen", seedFile: "computer.tsx", thumb: "computer.png" },
  { id: "settings-page", name: "Settings page", description: "DevRev settings layout", seedFile: "settings-page.tsx", thumb: "settings-page.png" },
  { id: "app-list", name: "App list", description: "DevRev list view", seedFile: "app-list.tsx", thumb: "app-list.png" },
];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function readTemplateSeed(id: TemplateId): Promise<string> {
  const def = getTemplate(id);
  if (!def) return Promise.reject(new Error(`Unknown template: ${id}`));
  return fs.readFile(path.join(TEMPLATE_SEEDS_DIR, def.seedFile), "utf-8");
}
