# DevRev API integration reference

Read this file ONLY when the designer explicitly asks for live DevRev data
("show my tickets", "list my chats with Computer", "dashboard of open issues",
"the Design System sprint board"). For static prototypes with hardcoded
content — the common case — you never need this file.

If this project has DevRev integration enabled, a `shared/devrev.ts` helper module will exist in the project directory. Check for it with `Read shared/devrev.ts` before using.

## Available functions

The helper exports 14 functions corresponding to DevRev REST endpoints:

- `listWorks(args)` — List work items (issues, tickets, tasks)
- `getWork(id)` — Get a single work item by ID
- `createWork(args)` — Create a new work item
- `updateWork(args)` — Update a work item
- `listAccounts(args)` — List accounts
- `listConversations(args)` — List customer support **conversations** (NOT DevUser chats with Computer — see terminology note below)
- `self()` — Get the current user
- `listDevUsers(args)` — List dev users
- `listParts(args)` — List parts (products, capabilities, features)
- `listRevOrgs(args)` — List rev orgs
- `listTags(args)` — List tags
- `countWorks(args)` — Count works matching a filter
- `listEngagements(args)` — List engagements
- `listLinks(args)` — List links between objects

Each function returns `Promise<unknown>`. Cast the result to the expected shape (e.g., `{ works: Array<{id: string, title: string, ...}> }`).

## Usage pattern

```tsx
import { listWorks } from "../shared/devrev";

export default function MyTicketDashboard() {
  const [tickets, setTickets] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    listWorks({ type: ["ticket"], limit: 20 })
      .then((data: any) => {
        setTickets(data.works || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading tickets...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h1>My Tickets ({tickets.length})</h1>
      <ul>
        {tickets.map((t) => (
          <li key={t.id}>
            {t.display_id}: {t.title} — {t.stage.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Terminology: chat vs conversation vs work item

DevRev has three distinct object types, and getting them confused produces the wrong UI. Pick carefully:

- **Chat (`chats.*`)** — DevUser ↔ Computer threads and DevUser ↔ DevUser DMs. This is what users mean by "my chats with Computer", "my messages", "conversational data", "chat history", "threads with the AI", or anything about their own dialogue with agents or teammates. **If the user says "conversational" or "conversation" in casual speech and they work at DevRev, they almost always mean CHAT.**
- **Conversation (`conversations.list`)** — customer support conversations. A RevUser (customer) messages a support queue / portal; DevUsers reply. This is NOT a DevUser's personal chat history. Use this only when the user explicitly says "customer conversations", "support", "inbox", or "RevUser messages".
- **Work item (`works.list`)** — issues, tickets, tasks, bugs. Use only when the user explicitly says "ticket", "issue", "bug", "task", or "work item".

If you are uncertain which the user meant:
1. If they mention Computer, an AI agent, or their own chat/message history → **chat**.
2. If they mention a customer or support inbox → **conversation**.
3. If they mention tickets/bugs/issues → **work item**.

When in doubt and the user works at DevRev (which is almost always the case for Arcade Studio), default to **chat** for anything that sounds dialogue-shaped.

## Fetching chats (the DevUser's own threads)

`chats.*` and `timeline-entries.*` are **internal** (not public/beta) DevRev endpoints. They are NOT wrapped in the generated `shared/devrev.ts` helper. Call the proxy directly at the `/api/devrev/internal/*` path — **do not** use `/api/devrev/chats.list` (public path, 404s):

```tsx
async function listMyChats(limit = 20) {
  // Lists the current DevUser's DMs (Computer chats + DevUser↔DevUser threads).
  // The proxy injects auth server-side; the PAT identifies the caller.
  const res = await fetch("/api/devrev/internal/chats.list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sort_by: ["modified_date:desc"],
      type: ["dm"],
      limit,
    }),
  });
  if (!res.ok) throw new Error(`chats.list failed: ${res.status}`);
  return res.json() as Promise<{ chats?: Array<Record<string, unknown>> }>;
}

async function listChatMessages(chatId: string) {
  const res = await fetch("/api/devrev/internal/timeline-entries.list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ object: chatId }),
  });
  if (!res.ok) throw new Error(`timeline-entries.list failed: ${res.status}`);
  return res.json() as Promise<{ timeline_entries?: Array<Record<string, unknown>> }>;
}
```

Notes:
- The endpoint is `/api/devrev/internal/chats.list`, not `/api/devrev/chats.list`. Same for timeline entries. The proxy forwards whatever path comes after `/api/devrev/` to `https://api.devrev.ai/…`, so `internal/…` resolves to `https://api.devrev.ai/internal/chats.list`.
- `sort_by: ["modified_date:desc"]` puts the most recently active threads first — the natural order for a chat list.
- **Do NOT pass `dm: { is_default: false }`.** Counter-intuitively, the human↔human DM chats carry `is_default: true` while the Computer **sessions** carry `is_default: false` — so filtering on `is_default: false` silently drops EVERY human chat and the "Chats" group renders empty. Omit the `dm` filter entirely so both kinds come back; the Sessions/Chats split is done client-side on `agent_metadata.is_agent_chat` (see next section), NOT via this filter.
- `type: ["dm"]` limits to direct-message threads (Computer sessions + DMs with teammates). Omit `type` for all chat kinds.
- Timeline entries returned by `/internal/timeline-entries.list` carry message bodies, system events, attachments. Filter on `type === "timeline_comment"` to get just the messages when rendering a transcript.
- If these internal endpoints return 401/403, the PAT may not have access — surface the error in the UI (don't silently fall back to mock data). Do NOT fall back to `conversations.list`; those are customer support conversations, a different object type.

## Sessions vs Chats — the split that makes a Computer screen correct

`chats.list` returns BOTH kinds of DM in one list. The Computer UI shows them as **two separate sidebar groups**, and a flat single list is the #1 mistake here. Split on `agent_metadata`:

- **Sessions** — the DevUser's own threads with Computer. `agent_metadata.is_agent_chat === true` (and `agent_metadata.agent_chat_type === "session"`). Members are the user + `Computer`.
- **Chats** — human↔human DMs. `agent_metadata` is absent or `is_agent_chat` is falsy.

```tsx
const isSession = (c: any) => c?.agent_metadata?.is_agent_chat === true;
const sessions = chats.filter(isSession);
const humanChats = chats.filter((c) => !isSession(c));
```

**Render them as two `ComputerSidebar.Group`s — never one flat "Recent chats" list.** This mirrors the canonical scene (`00-computer-reference` / `ComputerScene`): a "Sessions" group above a "Chats" group.

```tsx
<ComputerSidebar user={…}>
  <ComputerSidebar.Group title="Sessions">
    {sessions.map((c) => (
      <ComputerSidebar.Item key={c.id} active={c.id === activeId} onClick={() => setActiveId(c.id)}>
        {chatTitle(c)}
      </ComputerSidebar.Item>
    ))}
  </ComputerSidebar.Group>
  <ComputerSidebar.Group title="Chats">
    {humanChats.map((c) => (
      <ComputerSidebar.Item key={c.id} active={c.id === activeId} onClick={() => setActiveId(c.id)}
        leading={<Avatar name={chatTitle(c)} size="sm" />}>
        {chatTitle(c)}
      </ComputerSidebar.Item>
    ))}
  </ComputerSidebar.Group>
</ComputerSidebar>
```

Title fallbacks differ by kind: **sessions** carry a real `title` (the conversation topic). **Human chats** usually have `title: null` — derive the label from the other member's `display_name` (the participant who is not the signed-in user), not "Untitled chat". Read members from `c.members` / `c.users`.

This is a real-data variant of the canonical scene, so build it on the `ComputerPage` slot graph (not `<ComputerScene />`, which is static-by-default). Keep `ComputerHeader`, `ChatInput`, and the `ChatMessages` transcript exactly as the reference uses them — only the sidebar groups and transcript are data-driven.

## Fetching customer conversations (support inbox)

Only use when the user explicitly asks about customer support, RevUser threads, or a support inbox. Uses the wrapped `listConversations` helper plus `timeline-entries.list` for messages — same shape as the chat pattern above but calling `/api/devrev/conversations.list`.

## Fetching a vista (sprint board)

A **vista** in DevRev is a sprint board: a named container that groups work items into sprints (aka "group items" in the API). When a user says "the Design System sprint board", "our Q2 sprint", "the roadmap vista", they are describing a vista.

**Endpoint:** `/api/devrev/vistas.get` — **public** path, not `/internal/`. Do NOT invent `/vistas.query`, `/vistas.list`, or `/internal/vistas.*`; none of those exist and they all 404.

**ID format:** the URL `https://app.devrev.ai/devrev/vistas/vista-12556` encodes the display ID (`vista-12556`). The API wants a full DON:

```
don:core:dvrv-us-1:devo/0:vista/12556
```

(drop the `vista-` prefix, prepend the DON scheme). If you're unsure about `devo/0` vs `devo/<id>`, `devo/0` works for the caller's own org.

**Fetching the works inside the vista** is a two-step flow:

```tsx
async function listVistaWorks(vistaDisplayId: string) {
  // 1. Resolve the vista to learn its sprint group IDs.
  const vistaDon = `don:core:dvrv-us-1:devo/0:vista/${vistaDisplayId.replace(/^vista-/, "")}`;
  const vRes = await fetch("/api/devrev/vistas.get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: vistaDon }),
  });
  if (!vRes.ok) throw new Error(`vistas.get failed: ${vRes.status}`);
  const { vista } = (await vRes.json()) as {
    vista: { group_items?: Array<{ id: string }> };
  };
  const sprintIds = (vista?.group_items ?? []).map((g) => g.id);

  // 2. Filter works.list by the sprint-group custom field.
  const wRes = await fetch("/api/devrev/works.list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: ["issue", "ticket"],
      "custom_fields.tnt__sprint_group": sprintIds,
      limit: 50,
    }),
  });
  if (!wRes.ok) throw new Error(`works.list failed: ${wRes.status}`);
  return (await wRes.json()) as { works?: Array<Record<string, unknown>> };
}
```

Notes:
- The field name `custom_fields.tnt__sprint_group` is the canonical sprint-group filter across most DevRev orgs; if your org customized it, the DON of any group item still works as an ID you can pass.
- If the user didn't provide a vista URL, ask for one — vistas are per-org data and guessing names never resolves.
- Surface the error if either call fails; do NOT fall back to mock data.

## Filtering and pagination

Most list endpoints accept filter args (dot-notation supported for nested filters):

```tsx
// Filter by stage name
listWorks({ type: ["issue"], "stage.name": ["triage", "in_progress"], limit: 50 })

// Pagination: use next_cursor from response
const response: any = await listWorks({ limit: 50 });
const nextPageResponse: any = await listWorks({ limit: 50, cursor: response.next_cursor });
```

## Mutations (create, update)

Write operations skip the cache and require specific fields:

```tsx
// Create a new issue
await createWork({
  title: "API timeout in payments service",
  type: "issue",
  applies_to_part: "PROD-123",
  owned_by: ["DEVU-456"],
});

// Update a work item
await updateWork({
  id: "ISS-789",
  title: "Updated title",
  "stage.name": "done",
});
```

## Error handling

All functions throw on network errors or non-2xx responses. Wrap calls in try/catch or `.catch()`.

## When to use DevRev data

Only fetch DevRev data when the designer explicitly asks for it ("show my tickets", "list accounts", "dashboard of open issues"). Do NOT fetch data speculatively or for generic UI mockups. If the designer does not mention DevRev data, build a static prototype with hardcoded content.
