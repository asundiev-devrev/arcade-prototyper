import type { ChimeIn } from "./types";

/**
 * Pure transforms over a project's chime-in list. The caller owns IO:
 * read project.chimeIns, apply a transform, persist via updateProject.
 */

export interface NewChimeIn {
  id: string;
  frameSlug: string;
  objection: string;
  createdAt: string;
}

/** Append a chime-in, unless an identical pending objection already exists
 *  for the same frame (dedup across consecutive turns). */
export function addChimeIn(list: ChimeIn[], next: NewChimeIn): ChimeIn[] {
  const dup = list.some(
    (c) =>
      c.status === "pending" &&
      c.frameSlug === next.frameSlug &&
      c.objection.trim() === next.objection.trim(),
  );
  if (dup) return list;
  return [...list, { ...next, status: "pending" }];
}

/** Auto-dismiss pending chime-ins about a frame that has since changed —
 *  the objection may no longer apply. */
export function markStaleByFrame(list: ChimeIn[], frameSlug: string): ChimeIn[] {
  return list.map((c) =>
    c.status === "pending" && c.frameSlug === frameSlug
      ? { ...c, status: "dismissed" as const }
      : c,
  );
}

export function dismissChimeIn(list: ChimeIn[], id: string): ChimeIn[] {
  return list.map((c) => (c.id === id ? { ...c, status: "dismissed" as const } : c));
}

export function applyChimeIn(list: ChimeIn[], id: string): ChimeIn[] {
  return list.map((c) => (c.id === id ? { ...c, status: "applied" as const } : c));
}

export function pendingObjections(list: ChimeIn[]): string[] {
  return list.filter((c) => c.status === "pending").map((c) => c.objection);
}
