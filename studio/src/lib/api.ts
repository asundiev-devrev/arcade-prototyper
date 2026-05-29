import type { Project, Frame } from "../../server/types";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg: string;
    try { msg = (await res.json()).error?.message ?? `HTTP ${res.status}`; }
    catch { msg = `HTTP ${res.status}`; }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : (await res.json()) as T;
}

export const api = {
  listProjects: () => fetch("/api/projects").then(j<Project[]>),
  createProject: (input: { name: string; theme: "arcade" | "devrev-app"; mode: "light" | "dark" }) =>
    fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then(j<Project>),
  renameProject: (slug: string, name: string) =>
    fetch(`/api/projects/${slug}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(j<Project>),
  deleteProject: (slug: string) =>
    fetch(`/api/projects/${slug}`, { method: "DELETE" }).then(j<void>),
  stageUpload: (blob: Blob) =>
    fetch("/api/uploads/_staging", {
      method: "POST",
      headers: { "Content-Type": blob.type },
      credentials: "include",
      body: blob,
    }).then(j<{ path: string; url: string }>),
  adoptUploads: (slug: string, paths: string[]) =>
    fetch(`/api/projects/${slug}/adopt-uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    }).then(j<{ mapping: Record<string, string>; missing: string[] }>),
  createFrame: (slug: string) =>
    fetch(`/api/projects/${slug}/frames`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(j<Frame>),
  deleteFrame: (slug: string, frameSlug: string) =>
    fetch(`/api/projects/${slug}/frames/${frameSlug}`, {
      method: "DELETE",
    }).then(j<Project>),
  startChatTurn: (slug: string, prompt: string, images: string[]) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, prompt, images }),
    }).then(j<{ turnId: string; slug: string }>),
  cancelTurn: (slug: string) =>
    fetch(`/api/chat/cancel/${slug}`, { method: "POST" }).then(
      j<{ cancelled: true; slug: string }>,
    ),
};
