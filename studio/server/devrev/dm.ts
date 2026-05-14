/**
 * DevRev DM helpers.
 *
 * Spike 2 findings (2026-05-09):
 *   - `chats.create` with `type: "dm"` and `users: [caller, recipient]`
 *     works with a PAT — BUT the caller MUST be included in `users`.
 *     A recipient-only users array returns 403.
 *   - If the DM already exists, `chats.create` returns 409 Conflict. Use
 *     `chats.get` with the same users to retrieve the existing DM id.
 *   - `timeline-entries.create` with `object: <dm DON>` posts a visible
 *     message into the recipient's Computer inbox. Sender appears as the
 *     PAT's human user, not a bot.
 *
 * This module does the minimum to deliver an invite: create/reuse the DM,
 * post the invite text. Callers handle higher-level concerns (what text
 * to post, when to post it).
 */

const BASE = "https://api.devrev.ai";

export async function createOrFetchDm(
  pat: string,
  callerDevu: string,
  recipientDevu: string,
): Promise<string> {
  const body = JSON.stringify({
    type: "dm",
    users: [callerDevu, recipientDevu],
  });
  const headers = { Authorization: pat, "Content-Type": "application/json" };

  const createRes = await fetch(`${BASE}/chats.create`, { method: "POST", headers, body });
  if (createRes.ok) {
    const data = (await createRes.json()) as { chat?: { id?: string } };
    const id = data.chat?.id;
    if (!id) throw new Error("DM created but response lacked chat.id");
    return id;
  }

  if (createRes.status === 409) {
    const getRes = await fetch(`${BASE}/chats.get`, { method: "POST", headers, body });
    if (!getRes.ok) {
      throw new Error(`DM exists but chats.get failed: ${getRes.status}`);
    }
    const data = (await getRes.json()) as { chat?: { id?: string } };
    const id = data.chat?.id;
    if (!id) throw new Error("chats.get returned no chat.id");
    return id;
  }

  if (createRes.status === 403) {
    throw new Error(
      "DevRev rejected DM creation (403). Check that the PAT is valid and both devu DONs are correct.",
    );
  }

  const text = await createRes.text().catch(() => "");
  throw new Error(`DM creation failed: ${createRes.status} ${text.slice(0, 200)}`);
}

export async function postToDm(
  pat: string,
  dmId: string,
  body: string,
): Promise<void> {
  const res = await fetch(`${BASE}/timeline-entries.create`, {
    method: "POST",
    headers: { Authorization: pat, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "timeline_comment",
      object: dmId,
      body,
      // The `display:discussions` label is what tells Computer's UI to
      // render this entry as a first-class chat message (URL auto-linking,
      // unread counter, desktop notifications). Without it, API-posted
      // entries show up as inert plain text — visible if you open the DM
      // but never marking it unread, and URLs don't render as clickable.
      // Discovered 2026-05-14 by comparing API-posted entries (no label)
      // to real-user replies in the same DM (labeled). See docs:
      // https://developer.devrev.ai/public/beta/api-reference/timeline-entries
      labels: ["display:discussions"],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to post to DM: ${res.status} ${text.slice(0, 200)}`);
  }
}
