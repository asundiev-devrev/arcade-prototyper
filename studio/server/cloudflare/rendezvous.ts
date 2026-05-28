import { SHARE_WORKER_URL } from "./deploy";

// Studio-side client for the rendezvous routes added in Worker 0.21.0.
//
// Host publishes its current relay URL on tunnel acquire and on every Studio
// boot for projects with non-empty shared_with[]. Guest fetches before
// opening WS — the stored mirror.relayUrl is only a fallback for legacy
// 0.20.x mirrors whose host hasn't republished yet.
//
// The Worker URL is the same one used by deploy.ts (share Worker is
// shared infrastructure).

export interface RendezvousRecord {
  shareId: string;
  relayUrl: string;
  hostDevu: string;
  hostDisplayName: string;
  publishedAt: number;
}

export class RendezvousNotFoundError extends Error {
  constructor(shareId: string) {
    super(`No rendezvous record for ${shareId}`);
    this.name = "RendezvousNotFoundError";
  }
}

export async function publishRendezvous(opts: {
  shareKey: string;
  shareId: string;
  relayUrl: string;
  hostDevu: string;
  hostDisplayName: string;
  workerUrl?: string;
}): Promise<void> {
  const workerUrl = opts.workerUrl ?? SHARE_WORKER_URL;
  const res = await fetch(`${workerUrl}/rendezvous/${opts.shareId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.shareKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      relayUrl: opts.relayUrl,
      hostDevu: opts.hostDevu,
      hostDisplayName: opts.hostDisplayName,
    }),
  });
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch {}
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Rendezvous publish failed: ${msg}`);
  }
}

export async function fetchRendezvous(opts: {
  shareKey: string;
  shareId: string;
  workerUrl?: string;
}): Promise<RendezvousRecord> {
  const workerUrl = opts.workerUrl ?? SHARE_WORKER_URL;
  const res = await fetch(`${workerUrl}/rendezvous/${opts.shareId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${opts.shareKey}` },
  });
  if (res.status === 404) throw new RendezvousNotFoundError(opts.shareId);
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch {}
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Rendezvous fetch failed: ${msg}`);
  }
  const body = (await res.json()) as RendezvousRecord;
  return body;
}
