import fs from "node:fs/promises";
import path from "node:path";
import { sharedProjectDir, sharedProjectsRoot } from "../paths";

/**
 * On-disk mirror for a shared project on the GUEST side.
 *
 * Layout:
 *   <root>/shared-projects/<id>/
 *     metadata.json       — { id, relayUrl, hostDevu, hostDisplayName, projectSlug, addedAt, lastSeenAt }
 *     chat-history.json   — array of chat events received from the relay
 *     frames/<frameId>    — last-seen frame content (one file per path)
 *
 * The mirror exists so guests can revisit the project when the host is
 * offline. Writes are best-effort; failures here log and continue.
 */

export interface MirrorMetadata {
  id: string;
  relayUrl: string;
  hostDevu: string;
  hostDisplayName: string;
  projectSlug: string;
  addedAt: string;
  lastSeenAt: string;
}

export async function createMirror(input: {
  id: string;
  relayUrl: string;
  hostDevu: string;
  hostDisplayName: string;
  projectSlug: string;
}): Promise<void> {
  const dir = sharedProjectDir(input.id);
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  const meta: MirrorMetadata = {
    ...input,
    addedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify(meta, null, 2));
  await fs.writeFile(path.join(dir, "chat-history.json"), "[]");
}

export async function readMirror(id: string): Promise<MirrorMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(sharedProjectDir(id), "metadata.json"), "utf-8");
    return JSON.parse(raw);
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function appendChat(id: string, event: unknown): Promise<void> {
  const file = path.join(sharedProjectDir(id), "chat-history.json");
  let existing: unknown[] = [];
  try {
    existing = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {}
  existing.push(event);
  await fs.writeFile(file, JSON.stringify(existing, null, 2));
}

export async function readChat(id: string): Promise<unknown[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(sharedProjectDir(id), "chat-history.json"), "utf-8"));
  } catch {
    return [];
  }
}

export async function writeFrame(id: string, framePath: string, content: string): Promise<void> {
  const dir = path.join(sharedProjectDir(id), "frames");
  await fs.mkdir(dir, { recursive: true });
  // Frame paths are slugs, but we still sanitize to prevent path traversal.
  const safe = framePath.replace(/[^a-zA-Z0-9._-]/g, "_");
  await fs.writeFile(path.join(dir, safe), content, "utf-8");
}

export async function readFrames(id: string): Promise<Record<string, string>> {
  const dir = path.join(sharedProjectDir(id), "frames");
  try {
    const entries = await fs.readdir(dir);
    const out: Record<string, string> = {};
    for (const name of entries) {
      out[name] = await fs.readFile(path.join(dir, name), "utf-8");
    }
    return out;
  } catch {
    return {};
  }
}

export async function listMirrors(): Promise<MirrorMetadata[]> {
  try {
    const entries = await fs.readdir(sharedProjectsRoot());
    const out: MirrorMetadata[] = [];
    for (const id of entries) {
      const meta = await readMirror(id);
      if (meta) out.push(meta);
    }
    return out;
  } catch {
    return [];
  }
}

export async function deleteMirror(id: string): Promise<void> {
  await fs.rm(sharedProjectDir(id), { recursive: true, force: true });
}

export async function touchLastSeen(id: string): Promise<void> {
  const meta = await readMirror(id);
  if (!meta) return;
  meta.lastSeenAt = new Date().toISOString();
  await fs.writeFile(
    path.join(sharedProjectDir(id), "metadata.json"),
    JSON.stringify(meta, null, 2),
  );
}
