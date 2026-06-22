import fs from "node:fs/promises";
import path from "node:path";
import { userKitCompositesDir, userKitManifestPath } from "./paths";
import { packFromSource } from "./sidecar/packFromSource";

export interface ComponentMeta {
  name: string;
  description: string;
  createdAt: string;
  origin: string; // "saved" | "imported"
}

export class ComponentCompileError extends Error {}

const NAME_RE = /^[A-Z][A-Za-z0-9]{1,39}$/;
export function isValidComponentName(name: string): boolean {
  return NAME_RE.test(name);
}

async function readManifest(): Promise<ComponentMeta[]> {
  try {
    const raw = await fs.readFile(userKitManifestPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(entries: ComponentMeta[]): Promise<void> {
  await fs.mkdir(userKitCompositesDir(), { recursive: true });
  await fs.writeFile(userKitManifestPath(), JSON.stringify(entries, null, 2), "utf-8");
}

export async function listComponents(): Promise<ComponentMeta[]> {
  return readManifest();
}

export async function componentExists(name: string): Promise<boolean> {
  if (!isValidComponentName(name)) return false;
  try {
    await fs.access(path.join(userKitCompositesDir(), `${name}.tsx`));
    return true;
  } catch {
    return false;
  }
}

export async function saveComponentFile(args: {
  name: string; description: string; tsx: string; origin: string; createdAt: string;
}): Promise<void> {
  if (!isValidComponentName(args.name)) {
    throw new ComponentCompileError(`Invalid component name: ${args.name}`);
  }
  // Compile gate: a component that doesn't bundle never reaches disk.
  try {
    await packFromSource({ tsx: args.tsx });
  } catch (err) {
    throw new ComponentCompileError(
      `Component "${args.name}" failed to compile: ${(err as Error).message}`,
    );
  }
  await fs.mkdir(userKitCompositesDir(), { recursive: true });
  await fs.writeFile(path.join(userKitCompositesDir(), `${args.name}.tsx`), args.tsx, "utf-8");
  const entries = await readManifest();
  const next = entries.filter((e) => e.name !== args.name);
  next.push({ name: args.name, description: args.description, createdAt: args.createdAt, origin: args.origin });
  await writeManifest(next);
}

export async function deleteComponent(name: string): Promise<void> {
  if (!isValidComponentName(name)) return;
  await fs.rm(path.join(userKitCompositesDir(), `${name}.tsx`), { force: true });
  const entries = await readManifest();
  await writeManifest(entries.filter((e) => e.name !== name));
}
