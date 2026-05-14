import { getDevRevPat } from "../secrets/keychain";

/**
 * Paginated, cached fetch of DevRev's `dev-users.list`. The full org is
 * ~4k rows (2026-05-14), so the naive single-call-with-limit approach
 * silently truncates — Konstantin and Athila live on page 5 and page 3
 * respectively, well past the 500-row per-page cap.
 *
 * We paginate all pages once, filter to mentionable humans, and cache the
 * result in memory for 10 minutes. 10 minutes is short enough that new
 * hires / state transitions propagate, long enough that opening a new
 * project doesn't hit the API 8 times.
 *
 * Filters applied (consistent with the client-side filter we used to have):
 *   - email ends with @devrev.ai (drops gmail externals)
 *   - state === "active" (drops shadow role mailboxes, contractor c-*
 *     accounts, test accounts, deactivated humans)
 */

export interface MentionableUser {
  id: string;
  displayName: string;
  email: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 500;

interface CacheEntry {
  users: MentionableUser[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

function isFresh(entry: CacheEntry | null): entry is CacheEntry {
  return entry !== null && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

interface DevUserRow {
  id: string;
  display_name?: string;
  email?: string;
  state?: string;
}

async function fetchAllDevUsers(pat: string): Promise<DevUserRow[]> {
  const out: DevUserRow[] = [];
  let cursor: string | null = null;
  // Safety cap: if the org ever grows past 20k users we'll notice before
  // we hammer the API.
  for (let page = 0; page < 40; page++) {
    const body: Record<string, unknown> = { limit: PAGE_SIZE };
    if (cursor) body.cursor = cursor;
    const res = await fetch("https://api.devrev.ai/dev-users.list", {
      method: "POST",
      headers: { Authorization: pat, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`dev-users.list failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      dev_users?: DevUserRow[];
      next_cursor?: string | null;
    };
    out.push(...(data.dev_users ?? []));
    if (!data.next_cursor) return out;
    cursor = data.next_cursor;
  }
  // Defensive: if we hit the cap, return what we have rather than
  // refusing — partial list is better than no list.
  return out;
}

function filterAndNormalize(rows: DevUserRow[]): MentionableUser[] {
  const out: MentionableUser[] = [];
  for (const u of rows) {
    const email = u.email ?? "";
    if (!email.endsWith("@devrev.ai")) continue;
    if (u.state && u.state !== "active") continue;
    if (!u.id || !u.display_name) continue;
    out.push({
      id: u.id,
      displayName: u.display_name,
      email,
    });
  }
  return out;
}

/**
 * Returns the cached mentionable-users list, refreshing from the API if the
 * cache is stale. Callers must supply the PAT themselves (avoids awaiting
 * the keychain when the cache is warm).
 */
export async function listMentionableUsers(pat?: string): Promise<MentionableUser[]> {
  if (isFresh(cache)) return cache.users;
  const effectivePat = pat ?? (await getDevRevPat()) ?? process.env.DEVREV_PAT ?? "";
  if (!effectivePat) {
    // No PAT — return whatever we have, even if stale, so the popover keeps
    // working across PAT-rotation windows. Empty if we've never fetched.
    return cache?.users ?? [];
  }
  try {
    const rows = await fetchAllDevUsers(effectivePat);
    cache = { users: filterAndNormalize(rows), fetchedAt: Date.now() };
    return cache.users;
  } catch (err) {
    console.warn("[devUsers] fetch failed:", err);
    return cache?.users ?? [];
  }
}

/** Test-only: wipe the cache. */
export function __resetDevUsersCacheForTests(): void {
  cache = null;
}
