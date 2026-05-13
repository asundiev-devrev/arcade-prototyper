// Studio-side client for the share Worker at studio/worker/.
//
// We no longer call the Cloudflare API directly from Studio; instead the
// Worker holds the real Cloudflare API token and we send it a bundle plus
// a per-user share key. See studio/worker/README.md for how the Worker is
// deployed and how keys are minted.
//
// The URL below is baked in at build time — Studio is an internal tool
// with a single known-good share service. If we ever need to point staging
// builds elsewhere, turn this into a setting.
export const SHARE_WORKER_URL = "https://arcade-studio-share.devrev-product-design.workers.dev";

export interface WorkerFile {
  file: string;
  data: string;
}

export interface WorkerDeployment {
  url: string;
  deployId: string;
}

// Cloudflare Pages project names: lowercase, alphanumeric + hyphens, ≤ 58
// chars. Studio slugs are usually fine but we normalize defensively so
// edge cases (leading digits, custom renames) never hit the API with an
// invalid name. Kept in Studio (not the Worker) so the client sees the
// same project name it will read back later.
export function normalizeProjectName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58);
  if (!cleaned) return "arcade-frame";
  if (/^[0-9]/.test(cleaned)) return `p-${cleaned}`.slice(0, 58);
  return cleaned;
}

// Branch names can be longer and more permissive than project names, but
// they appear as subdomain prefix (`<branch>.<project>.pages.dev`), so
// keep them URL-safe and short — Cloudflare truncates overlong branches
// in the alias URL.
export function normalizeBranchName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return cleaned || "frame";
}

export async function deployViaWorker({
  shareKey,
  pagesProjectName,
  branch,
  projectSlug,
  files,
  workerUrl = SHARE_WORKER_URL,
}: {
  shareKey: string;
  pagesProjectName: string;
  branch: string;
  projectSlug: string;
  files: WorkerFile[];
  workerUrl?: string;
}): Promise<WorkerDeployment> {
  const res = await fetch(`${workerUrl}/share`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${shareKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectSlug, pagesProjectName, branch, files }),
  });

  if (!res.ok) {
    let errBody: any = null;
    try { errBody = await res.json(); } catch {}
    const msg = errBody?.error?.message ?? `HTTP ${res.status}`;
    // Surface the Worker's error code so the middleware can map specific
    // cases (invalid_key → 401 to the UI) to actionable messages.
    const err = new Error(msg) as Error & { code?: string; status?: number };
    err.code = errBody?.error?.code;
    err.status = res.status;
    throw err;
  }

  const body = await res.json() as { url: string; deployId: string };
  return { url: body.url, deployId: body.deployId };
}
