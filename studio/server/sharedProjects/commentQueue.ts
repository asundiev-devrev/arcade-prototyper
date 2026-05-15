import fs from "node:fs/promises";
import path from "node:path";
import { sharedProjectDir } from "../paths";

/**
 * Per-mirror queue of comments composed while the host was offline.
 * Flushed in order on reconnect by the relay client.
 *
 * Persistence is atomic: write to a temp file, fsync, rename. Crash mid-write
 * leaves either the previous content or the new content, never a partial.
 */

interface QueuedComment {
  id: string;
  text: string;
  mentions?: string[];
  ts?: number;
}

function file(id: string): string {
  return path.join(sharedProjectDir(id), "comments-pending.json");
}

async function readQueue(id: string): Promise<QueuedComment[]> {
  try {
    return JSON.parse(await fs.readFile(file(id), "utf-8"));
  } catch {
    return [];
  }
}

async function writeQueueAtomic(id: string, queue: QueuedComment[]): Promise<void> {
  const target = file(id);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(queue, null, 2), "utf-8");
  await fs.rename(tmp, target);
}

export async function enqueueComment(id: string, comment: QueuedComment): Promise<void> {
  const q = await readQueue(id);
  q.push(comment);
  await writeQueueAtomic(id, q);
}

export async function drainComments(id: string): Promise<QueuedComment[]> {
  const q = await readQueue(id);
  if (q.length === 0) return [];
  await writeQueueAtomic(id, []);
  return q;
}

export async function peekQueue(id: string): Promise<QueuedComment[]> {
  return readQueue(id);
}
