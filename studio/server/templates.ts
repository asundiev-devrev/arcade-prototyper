import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATE_SEEDS_DIR = path.resolve(STUDIO_DIR, "prototype-kit", "template-seeds");
export const TEMPLATE_THUMBS_DIR = path.resolve(STUDIO_DIR, "prototype-kit", "template-thumbs");

export type TemplateId = "computer" | "computer-settings" | "builder-page";

export interface TemplateDef {
  id: TemplateId;
  name: string;
  description: string;
  seedFile: string; // basename of a .tsx file OR a directory under TEMPLATE_SEEDS_DIR
  thumb: string;
}

export const TEMPLATES: TemplateDef[] = [
  { id: "computer", name: "Computer: Chat", description: "Agent chat screen (with in-place Settings view)", seedFile: "computer", thumb: "computer.png" },
  { id: "computer-settings", name: "Computer: Settings", description: "Full Computer settings", seedFile: "computer/settings", thumb: "computer-settings.png" },
  { id: "builder-page", name: "Agent Studio: Builder", description: "Agent capability builder", seedFile: "builder-page.tsx", thumb: "builder-page.png" },
];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templateSeedPath(id: string): string {
  const def = getTemplate(id);
  if (!def) throw new Error(`Unknown template: ${id}`);
  return path.join(TEMPLATE_SEEDS_DIR, def.seedFile);
}

export async function isSeedDirectory(id: string): Promise<boolean> {
  try {
    const st = await fs.stat(templateSeedPath(id));
    return st.isDirectory();
  } catch {
    return false;
  }
}

export async function readTemplateSeed(id: TemplateId): Promise<string> {
  const def = getTemplate(id);
  if (!def) throw new Error(`Unknown template: ${id}`);
  // A seed is either a single .tsx file or a directory whose entry is
  // index.tsx (e.g. "computer", "computer/settings"). For a directory seed,
  // return its index.tsx source.
  const seedPath = path.join(TEMPLATE_SEEDS_DIR, def.seedFile);
  const entry = (await isSeedDirectory(id))
    ? path.join(seedPath, "index.tsx")
    : seedPath;
  return fs.readFile(entry, "utf-8");
}
