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
  // Optional from 0.21+: resolved at connect time via Worker rendezvous.
  // Older mirrors imported under 0.20.x still have this populated; new
  // ones from 0.21+ omit it entirely.
  relayUrl?: string;
  hostDevu: string;
  hostDisplayName: string;
  projectSlug: string;
  addedAt: string;
  lastSeenAt: string;
}

export async function createMirror(input: {
  id: string;
  relayUrl?: string;
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
    // Treat truncated/invalid JSON the same as a missing file. Without this
    // a single corrupt mirror (e.g. zero-byte metadata.json from a crash
    // mid-write) propagates through listMirrors() and hides every other
    // shared project from the user.
    if (err?.code === "ENOENT" || err instanceof SyntaxError) return null;
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

/**
 * Sanitize an arbitrary frame path into a filesystem-safe filename. Same
 * regex used by `writeFrame` so call sites that need to look up the file
 * (e.g. the spectator frame compile endpoint) can resolve the on-disk
 * path without re-implementing the rule.
 */
export function sanitizeFramePathForFs(framePath: string): string {
  return framePath.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Resolve the on-disk path for a cached frame. Looks for the modern
 * `<safe>.tsx` filename first, falls back to the legacy extension-less
 * `<safe>` for mirrors that pre-date 0.23 (those will refresh on the
 * next `cache_replay`, but until they do we still want to serve them).
 * Returns null if neither exists.
 */
export async function resolveFrameFsPath(
  id: string,
  framePath: string,
): Promise<string | null> {
  const dir = path.join(sharedProjectDir(id), "frames");
  const safe = sanitizeFramePathForFs(framePath);
  const withExt = path.join(dir, `${safe}.tsx`);
  try {
    await fs.access(withExt);
    return withExt;
  } catch {}
  const legacy = path.join(dir, safe);
  try {
    await fs.access(legacy);
    return legacy;
  } catch {}
  return null;
}

export async function writeFrame(id: string, framePath: string, content: string): Promise<void> {
  const dir = path.join(sharedProjectDir(id), "frames");
  await fs.mkdir(dir, { recursive: true });
  // Frame paths are slugs, but we still sanitize to prevent path traversal.
  // The `.tsx` extension is appended so Vite's transform pipeline can pick
  // up the file when the spectator frame compile endpoint imports it.
  const safe = sanitizeFramePathForFs(framePath);
  await fs.writeFile(path.join(dir, `${safe}.tsx`), content, "utf-8");
}

export async function readFrames(id: string): Promise<Record<string, string>> {
  const dir = path.join(sharedProjectDir(id), "frames");
  try {
    const entries = await fs.readdir(dir);
    const out: Record<string, string> = {};
    for (const name of entries) {
      // Strip the `.tsx` extension so consumers (the spectator React shell)
      // see the same logical key the host's `frame_written` event used.
      // Legacy mirrors (pre-0.23) wrote files without the extension; pass
      // those through as-is so the slug stays stable.
      const key = name.endsWith(".tsx") ? name.slice(0, -4) : name;
      out[key] = await fs.readFile(path.join(dir, name), "utf-8");
    }
    return out;
  } catch {
    return {};
  }
}

export async function listMirrors(): Promise<MirrorMetadata[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(sharedProjectsRoot());
  } catch {
    return [];
  }
  const out: MirrorMetadata[] = [];
  for (const id of entries) {
    // Skip per-entry failures so one bad mirror can't hide the rest.
    try {
      const meta = await readMirror(id);
      if (meta) out.push(meta);
    } catch (err) {
      console.warn(`[sharedProjects] skipping unreadable mirror ${id}:`, err);
    }
  }
  return out;
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
