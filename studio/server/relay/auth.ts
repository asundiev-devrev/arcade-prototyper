/**
 * Resolve a DevRev PAT to a devu identity by calling `dev-users.self`.
 *
 * Used at WebSocket connect time (relay/wsServer.ts) and at session-create
 * time (middleware/multiplayer.ts). Returns null for any failure path —
 * callers distinguish "not authenticated" from "other error" based on
 * context, not this function's return value.
 */

export interface DevuIdentity {
  id: string;           // e.g. "don:identity:dvrv-us-1:devo/0:devu/6654"
  displayName: string;  // e.g. "Andrey Sundiev"
  email?: string;
}

export async function resolveDevuFromPat(pat: string): Promise<DevuIdentity | null> {
  if (!pat) return null;
  try {
    const res = await fetch("https://api.devrev.ai/dev-users.self", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: pat },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      dev_user?: { id?: string; display_name?: string; email?: string };
    };
    if (data.dev_user?.id && data.dev_user?.display_name) {
      return { id: data.dev_user.id, displayName: data.dev_user.display_name, email: data.dev_user.email };
    }
    return null;
  } catch {
    return null;
  }
}
