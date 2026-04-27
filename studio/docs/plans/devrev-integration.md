# DevRev API Integration for Arcade Studio

## Goal

Port the DevRev API integration from playground to studio, enabling designers to prototype data-connected DevRev features inside studio-generated frames. Studio frames will be able to fetch live work items, accounts, conversations, and other DevRev objects using a per-project Personal Access Token (PAT), with the agent automatically generating helper code and data-fetching logic during frame creation.

Unlike playground's `<Renderer>` DSL approach (`Query("devrev_list_works", args, shape)`), studio frames are plain React components. The integration provides:

1. A stateless proxy middleware at `/api/devrev/*` that forwards requests to `api.devrev.ai` with retry logic
2. Per-project PAT storage with UI for configuration and validation
3. A generated `shared/devrev.ts` helper module per project that exposes typed fetch functions the agent can import in frames
4. Agent prompt augmentation teaching Claude how to use the DevRev helpers and providing concrete examples
5. Security-conscious PAT handling (encrypted at-rest via macOS Keychain, never in plaintext in `project.json`)

## Non-goals

- **NOT porting the playground's DSL or tool-provider pattern** — studio frames are plain React, not `@openuidev/react-lang` DSL trees
- **NOT implementing server-side response caching** — studio's middleware is stateless for simplicity (phase 1). May revisit if rate limits become an issue
- **NOT multi-org PAT management** — one PAT per project. If a designer needs to prototype for multiple DevRev orgs, they create separate studio projects (per-project PAT already supports this implicitly)
- **NOT OS-agnostic keychain** — phase 2 will use macOS Keychain via `keytar` npm package. Linux/Windows support deferred (escape hatch: plaintext in `{projectDir}/.secrets.json` as a backup option)
- **NOT automatic PAT provisioning** — the designer must obtain their PAT from DevRev's web UI and paste it into studio. No OAuth flow

## Design decisions

### 1. PAT scope and storage strategy

**Decision (RESOLVED): Per-project PAT storage, encrypted at-rest via macOS Keychain using `keytar`, with a keychain reference stored in `project.json`.**

**Rationale:**
- Per-project storage allows prototyping for different DevRev orgs or user personas across projects
- macOS Keychain is platform-standard secure storage (encryption, access control, Touch ID / FileVault integration)
- Keychain reference in `project.json` is not sensitive; the actual PAT never appears in synced/committed files
- If `keytar` adds complexity, v1 fallback: plaintext in `{projectDir}/.secrets.json` (gitignored)

**Implementation (phase 2):**
- Add `keytar@^7.9.0` to `studio/package.json`
- Add optional `devrevPatKeychainId?: string` field to `Project` schema in `server/types.ts`
- Save: `keytar.setPassword("arcade-studio-devrev-pat-${slug}", "default", pat)` + store reference in `project.json`
- Retrieve: `keytar.getPassword(project.devrevPatKeychainId, "default")`
- Delete: `keytar.deletePassword(keychainId, "default")` when project is deleted
- Env var escape hatch: `DEVREV_PAT` still supported for testing (matches playground)

### 2. Proxy middleware architecture

**Decision (RESOLVED): Port playground's stateless `/api/devrev/*` middleware into `studio/server/middleware/devrev.ts` (from `playground/vite.config.ts:134-197`). No server-side cache for v1.**

**Rationale:**
- Stateless middleware reads `X-DevRev-Pat` from request header (sent by frame's fetch calls)
- Retries on 425/429/503 with exponential backoff (2s, 4s, 8s, 16s, 32s, max 5 attempts)
- No server-side cache to avoid complexity (invalidation, memory consumption). Client-side caching deferred to future phase

**Implementation (phase 1):**

File: `studio/server/middleware/devrev.ts`

```typescript
import type { Connect } from "vite";

const MAX_RETRIES = 5;
const RETRYABLE_STATUSES = new Set([425, 429, 503]);

export function devrevMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // Only handle /api/devrev/* routes
    if (!req.url?.startsWith("/api/devrev/")) return next();

    // Extract endpoint: /api/devrev/works.list → /works.list
    const endpoint = req.url.replace(/^\/api\/devrev/, "") || "/";

    // Read PAT from header (sent by frame's fetch calls)
    let pat = req.headers["x-devrev-pat"] as string | undefined;

    // If no header, try to load from keychain (phase 2)
    // For phase 1: read from in-memory Map keyed by slug (slug extracted from Referer header or query param)
    if (!pat) {
      // Phase 1: in-memory fallback (to be replaced with keychain in phase 2)
      // For now, return 401 if no PAT header is present
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No PAT configured" }));
      return;
    }

    // Read request body
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    // Retry loop with exponential backoff
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      lastResponse = await fetch(`https://api.devrev.ai${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: pat,
        },
        body: body || undefined,
      });

      // Break if not retryable
      if (!RETRYABLE_STATUSES.has(lastResponse.status)) {
        break;
      }

      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      const delay = Math.pow(2, attempt + 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (!lastResponse) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No response from DevRev API" }));
      return;
    }

    // Forward response
    const responseBody = await lastResponse.text();
    res.writeHead(lastResponse.status, {
      "Content-Type": "application/json",
    });
    res.end(responseBody);
  };
}
```

**Integration into `vite.config.ts`:**

```typescript
import { devrevMiddleware } from "./server/middleware/devrev";

export default defineConfig({
  // ... existing config
  plugins: [
    // ... existing plugins
    {
      name: "studio-middleware",
      configureServer(server) {
        server.middlewares.use(devrevMiddleware());
        // ... other middleware (chat, projects, figma, uploads, preflight, fonts)
      },
    },
  ],
});
```

### 3. Frame integration strategy

**Decision (RESOLVED): Generate `{projectDir}/shared/devrev.ts` helper module with 14 exported functions. Frames import via path alias. No window-globals exposed to user code.**

**Rationale:**
- Studio frames are plain React components (not DSL trees like playground)
- Generated helper is explicit, readable, agent can discover it via `Read`
- PAT injected as `window.__ARCADE_STUDIO_DEVREV_PAT__` by `frameMountPlugin` (reads from keychain, injects as inline script in iframe HTML)
- Helper exports: `listWorks`, `getWork`, `createWork`, `updateWork`, `listAccounts`, `listConversations`, `self`, `listDevUsers`, `listParts`, `listRevOrgs`, `listTags`, `countWorks`, `listEngagements`, `listLinks`
- Internal helpers: `cleanArgs`, `expandDotKeys` (ported from playground)

**Rejected Option B (React hook `useDevRev()`)**: Hook is "magic" (agent cannot read source), harder to teach, couples frames to studio internals. One-line reason: agent discoverability matters more than abstraction.

**Implementation (phase 3):**

1. **Scaffold `shared/devrev.ts` when a PAT is first configured** (POST `/api/projects/:slug/devrev-pat` saves to keychain, then writes helper with all 14 endpoint functions + JSDoc comments)
2. **Inject PAT into iframe via `frameMountPlugin`**: Read from keychain, inject as `<script>window.__ARCADE_STUDIO_DEVREV_PAT__ = "{{PAT}}";</script>` in iframe HTML
3. **TypeScript types**: Functions return `Promise<unknown>` (can add types later, not critical for v1)

### 4. Agent awareness and prompt augmentation

**Decision (RESOLVED): New DevRev section in `templates/CLAUDE.md.tpl` with usage examples for React + `useEffect` patterns.**

**Implementation (phase 4):**

Add new section to `templates/CLAUDE.md.tpl` after "Styling rules":

```markdown
## DevRev API integration (optional)

If this project has DevRev integration enabled, a `shared/devrev.ts` helper module will exist in the project directory. Check for it with `Read shared/devrev.ts` before using.

### Available functions

The helper exports 14 functions corresponding to DevRev REST endpoints:

- `listWorks(args)` — List work items (issues, tickets, tasks)
- `getWork(id)` — Get a single work item by ID
- `createWork(args)` — Create a new work item
- `updateWork(args)` — Update a work item
- `listAccounts(args)` — List accounts
- `listConversations(args)` — List conversations
- `self()` — Get the current user
- `listDevUsers(args)` — List dev users
- `listParts(args)` — List parts (products, capabilities, features)
- `listRevOrgs(args)` — List rev orgs
- `listTags(args)` — List tags
- `countWorks(args)` — Count works matching a filter
- `listEngagements(args)` — List engagements
- `listLinks(args)` — List links between objects

Each function returns `Promise<unknown>`. Cast the result to the expected shape (e.g., `{ works: Array<{id: string, title: string, ...}> }`).

### Usage pattern

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

### Filtering and pagination

Most list endpoints accept filter args (dot-notation supported for nested filters):

```tsx
// Filter by stage name
listWorks({ type: ["issue"], "stage.name": ["triage", "in_progress"], limit: 50 })

// Pagination: use next_cursor from response
const response: any = await listWorks({ limit: 50 });
const nextPageResponse: any = await listWorks({ limit: 50, cursor: response.next_cursor });
```

### Mutations (create, update)

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
  "stage.name": ["done"],
});
```

### Error handling

All functions throw on network errors or non-2xx responses. Wrap calls in try/catch or `.catch()`.

### When to use DevRev data

Only fetch DevRev data when the designer explicitly asks for it ("show my tickets", "list accounts", "dashboard of open issues"). Do NOT fetch data speculatively or for generic UI mockups. If the designer does not mention DevRev data, build a static prototype with hardcoded content.
```

Section is always present in template; agent checks for `shared/devrev.ts` before using.

### 5. Studio UI for PAT management

**Decision (RESOLVED): Settings drawer/panel opened from header (NOT sidebar — no sidebar in new Studio UI). "Settings" button in header (gear icon or part of project picker dropdown — implementation detail left open). Panel includes PAT input (masked), Validate button, status indicator (✓ Connected / ✗ Invalid / ⚠ Not configured), Remove button.**

**Implementation (phase 2):**

1. **Backend routes** (add to `server/middleware/projects.ts`):
   ```typescript
   // POST /api/projects/:slug/devrev-pat — saves PAT to keychain, scaffolds shared/devrev.ts if missing
   // GET /api/projects/:slug/devrev-pat/status — returns { configured, valid?, user? }
   // DELETE /api/projects/:slug/devrev-pat — deletes PAT from keychain
   ```

2. **Frontend component** (`src/components/projects/DevRevSettings.tsx`):
   ```tsx
   function DevRevSettings({ slug }: { slug: string }) {
     const [pat, setPat] = useState("");
     const [status, setStatus] = useState<{ configured: boolean; valid?: boolean; user?: any }>();
     const [validating, setValidating] = useState(false);

     useEffect(() => {
       fetch(`/api/projects/${slug}/devrev-pat/status`)
         .then((r) => r.json())
         .then(setStatus);
     }, [slug]);

     const handleSave = async () => {
       await fetch(`/api/projects/${slug}/devrev-pat`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ pat }),
       });
       // Refresh status
       const newStatus = await fetch(`/api/projects/${slug}/devrev-pat/status`).then((r) => r.json());
       setStatus(newStatus);
       setPat(""); // Clear input
     };

     const handleValidate = async () => {
       setValidating(true);
       const res = await fetch(`/api/projects/${slug}/devrev-pat/status?validate=true`);
       const newStatus = await res.json();
       setStatus(newStatus);
       setValidating(false);
     };

     const handleRemove = async () => {
       await fetch(`/api/projects/${slug}/devrev-pat`, { method: "DELETE" });
       setStatus({ configured: false });
     };

     return (
       <SettingsCard title="DevRev Integration">
         <SettingsRow
           label="Personal Access Token"
           description="Connect to DevRev API to fetch live data in prototypes."
           control={
             <Input
               type="password"
               value={pat}
               onChange={(e) => setPat(e.target.value)}
               placeholder="dvu_..."
             />
           }
           action={
             <>
               <Button size="sm" onClick={handleSave} disabled={!pat}>
                 Save
               </Button>
               {status?.configured && (
                 <Button size="sm" variant="secondary" onClick={handleValidate} disabled={validating}>
                   {validating ? "Validating..." : "Validate"}
                 </Button>
               )}
             </>
           }
         />
         {status?.configured && (
           <SettingsRow
             label="Status"
             description={status.valid ? `Connected as ${status.user?.display_name}` : "Invalid PAT"}
             control={<Badge variant={status.valid ? "success" : "error"}>{status.valid ? "✓ Connected" : "✗ Invalid"}</Badge>}
             action={
               <Button size="sm" variant="tertiary" onClick={handleRemove}>
                 Remove
               </Button>
             }
           />
         )}
       </SettingsCard>
     );
   }
   ```

3. **Integration into `ProjectDetail`**:
   - Add "Settings" button to header actions
   - Opens modal with `<DevRevSettings slug={openSlug} />`
   - Use arcade's `Modal` component (compound: `Modal.Root`, `Modal.Content`, `Modal.Title`, `Modal.Close`)

### 6. Security and secrets management

**Decision (RESOLVED): PATs stored in macOS Keychain (never in `project.json`). Keychain reference stored in `project.json`. PAT injected into iframe as `window.__ARCADE_STUDIO_DEVREV_PAT__` (acceptable — frame is data consumer, needs PAT). Env var escape hatch: `DEVREV_PAT` supported for testing.**

**Security boundary:**
- **Protected**: PAT in keychain (encrypted at-rest), `project.json` (only stores keychain reference)
- **Exposed**: PAT in iframe JS context (acceptable — designer writes/reviews frame code, PAT is user-scoped and revocable)

**Threat mitigation:**
- Designer commits `project.json` to Git: ✓ (only keychain reference, not PAT)
- Dropbox syncs studio files: ✓ (PAT in keychain, not synced files)
- Malicious frame code exfiltrates PAT: ✗ (acceptable risk — frame needs PAT to fetch data)

**Future improvement** (out of scope): "PAT proxy" pattern where middleware injects PAT server-side (frame never sees it). Deferred due to complexity.

## Files to create/modify

### Phase 1: Server middleware + client lib

| Path | Purpose |
|---|---|
| `studio/server/middleware/devrev.ts` | New middleware: stateless proxy to `api.devrev.ai` with retry logic (port from playground's `vite.config.ts:devrevProxyPlugin`) |
| `studio/vite.config.ts` | Import and mount `devrevMiddleware()` in the `configureServer` hook |
| `studio/server/types.ts` | Add optional `devrevPatKeychainId?: string` field to `projectSchema` (prepared for phase 2, unused in phase 1) |

### Phase 2: Per-project PAT storage + UI

| Path | Purpose |
|---|---|
| `studio/package.json` | Add `keytar@^7.9.0` dependency |
| `studio/server/lib/keychain.ts` | New helper: `savePat(slug, pat)`, `getPat(slug)`, `deletePat(slug)` — wraps `keytar` with error handling |
| `studio/server/middleware/projects.ts` | Add 3 routes: `POST /api/projects/:slug/devrev-pat`, `GET /api/projects/:slug/devrev-pat/status`, `DELETE /api/projects/:slug/devrev-pat` |
| `studio/server/projects.ts` | Update `deleteProject()` to also call `deletePat(slug)` when deleting a project |
| `studio/src/components/projects/DevRevSettings.tsx` | New component: Settings panel with PAT input, validate button, status indicator, remove button |
| `studio/src/routes/ProjectDetail.tsx` | Add "Settings" button to header/breadcrumb actions, modal to render `<DevRevSettings />` |
| `studio/src/lib/api.ts` | Add helper functions: `saveDevRevPat(slug, pat)`, `getDevRevPatStatus(slug)`, `deleteDevRevPat(slug)` |

### Phase 3: Frame integration (shared/devrev.ts helper generation)

| Path | Purpose |
|---|---|
| `studio/server/lib/scaffoldDevRevHelper.ts` | New helper: `scaffoldDevRevHelper(slug)` — writes `shared/devrev.ts` with all 14 endpoint functions + `cleanArgs` + `expandDotKeys` (port from playground) |
| `studio/server/middleware/projects.ts` | Update `POST /api/projects/:slug/devrev-pat` to call `scaffoldDevRevHelper(slug)` after saving PAT (if `shared/devrev.ts` does not exist) |
| `studio/server/plugins/frameMountPlugin.ts` | Update `load()` to read PAT from keychain and inject it as `<script>window.__ARCADE_STUDIO_DEVREV_PAT__ = "{{PAT}}";</script>` in the iframe HTML |
| `studio/server/middleware/devrev.ts` | (No change needed — middleware already reads `X-DevRev-Pat` from header sent by frame's fetch calls) |

### Phase 4: Agent prompt update (CLAUDE.md.tpl section)

| Path | Purpose |
|---|---|
| `studio/templates/CLAUDE.md.tpl` | Add new "DevRev API integration (optional)" section with function list, usage examples (React + `useEffect`), filtering patterns, error handling |
| `studio/server/projects.ts` | (No change — `refreshStaleClaudeMd()` already re-renders `CLAUDE.md` from the template when it changes) |

### Phase 5: Tests + docs

| Path | Purpose |
|---|---|
| `studio/__tests__/devrev-middleware.test.ts` | Unit tests: middleware retry logic, PAT header handling, error responses |
| `studio/__tests__/devrev-keychain.test.ts` | Integration tests: save/get/delete PAT from keychain (mocked `keytar`) |
| `studio/__tests__/devrev-e2e.test.ts` | E2E test: full flow (configure PAT → scaffold helper → frame imports and calls `listWorks`) |
| `studio/DEVELOPMENT.md` | Add "DevRev integration" section: how to obtain a PAT, where it's stored, how to test locally |
| `studio/ARCHITECTURE.md` | Update middleware table to list `devrev.ts`, update "Key types" section to document `devrevPatKeychainId` field |

## Implementation phases

### Phase 1: Server middleware (1-2 hours)

**Goal**: Middleware proxies DevRev API calls with retry logic.

**Exit criteria**:
- `server/middleware/devrev.ts` mounted in `vite.config.ts`
- Handles `/api/devrev/*`, proxies to `api.devrev.ai`, retries 425/429/503
- Manual test: curl with valid PAT returns user profile, invalid PAT returns 401

**Tasks**:
1. Create `server/middleware/devrev.ts` (port from `playground/vite.config.ts:134-197`)
2. Mount in `vite.config.ts` `configureServer` hook
3. Add optional `devrevPatKeychainId?: string` to `projectSchema` in `server/types.ts`
4. Manual test with curl

### Phase 2: PAT storage + Settings UI (3-4 hours)

**Goal**: Per-project PAT configuration via Settings UI, stored in macOS Keychain.

**Exit criteria**:
- `keytar` installed, Settings panel renders in `ProjectDetail`
- Save/Validate/Remove flows work
- Deleting project deletes PAT from keychain

**Tasks**:
1. Add `keytar@^7.9.0` to `package.json`
2. Create `server/lib/keychain.ts` with `savePat`, `getPat`, `deletePat` helpers
3. Add 3 routes to `server/middleware/projects.ts` (POST save, GET status, DELETE remove)
4. Update `server/projects.ts:deleteProject()` to call `deletePat(slug)`
5. Create `src/components/projects/DevRevSettings.tsx` (see component code in full plan)
6. Update `src/routes/ProjectDetail.tsx` (add Settings button, modal)
7. Add helpers to `src/lib/api.ts` (saveDevRevPat, getDevRevPatStatus, deleteDevRevPat)
8. Manual test: create project, save PAT, validate, remove, delete project

### Phase 3: Frame integration (3-4 hours)

**Goal**: Generate `shared/devrev.ts` helper, inject PAT into iframe.

**Exit criteria**:
- `shared/devrev.ts` scaffolded after PAT save
- Helper contains 14 endpoint functions + `cleanArgs` + `expandDotKeys`
- Frames can import and call functions
- PAT injected as `window.__ARCADE_STUDIO_DEVREV_PAT__` in iframe

**Tasks**:
1. Create `server/lib/scaffoldDevRevHelper.ts` (generates helper with all 14 functions + cleanArgs + expandDotKeys — see full code in plan)
2. Update `server/middleware/projects.ts:POST /api/projects/:slug/devrev-pat` to call `scaffoldDevRevHelper(slug)`
3. Update `server/plugins/frameMountPlugin.ts` to inject PAT as `<script>window.__ARCADE_STUDIO_DEVREV_PAT__ = "...";</script>` in iframe HTML head
4. Manual test: configure PAT, verify helper exists, generate test frame, verify data loads

### Phase 4: Agent prompt update (1-2 hours)

**Goal**: Agent can generate frames that fetch DevRev data.

**Exit criteria**:
- `templates/CLAUDE.md.tpl` contains DevRev section with function list, React examples, filtering/pagination/mutation patterns
- Agent generates correct data-fetching frames

**Tasks**:
1. Add new section to `templates/CLAUDE.md.tpl` after "Styling rules" (see full markdown in plan)
2. Manual test: create new project, prompt "show my open issues in a table", verify agent imports and uses `listWorks` correctly

### Phase 5: Tests + docs (4-6 hours)

**Goal**: Tested, documented, ready for rollout.

**Exit criteria**:
- Unit tests for middleware, keychain helpers
- E2E test for full flow
- `DEVELOPMENT.md` and `ARCHITECTURE.md` updated
- All manual tests pass

**Tasks**:
1. Create `__tests__/devrev-middleware.test.ts` (proxy, retry logic, error handling)
2. Create `__tests__/devrev-keychain.test.ts` (mocked `keytar` save/get/delete)
3. Create `__tests__/devrev-e2e.test.ts` (Playwright: configure PAT → scaffold → frame fetches data)
4. Update `DEVELOPMENT.md` (PAT setup, testing, security notes)
5. Update `ARCHITECTURE.md` (middleware table, Project schema)
6. Run all manual tests from phases 1-4

## Testing strategy

### Unit tests (phase 5)
- `__tests__/devrev-middleware.test.ts`: Test proxy, retry logic (425/429/503), non-retryable errors (400/404/500), PAT header handling
- `__tests__/devrev-keychain.test.ts`: Mock `keytar`, test save/get/delete PAT operations

### E2E test (phase 5)
- `__tests__/devrev-e2e.test.ts`: Full flow with Playwright (create project → configure PAT → scaffold helper → generate frame → verify data loads). Requires `TEST_DEVREV_PAT` env var.

### Manual tests
- **Phase 1**: curl middleware with valid/invalid PAT
- **Phase 2**: Settings UI flow (save, validate, remove, delete project)
- **Phase 3**: Generate frame, verify `shared/devrev.ts` exists, inspect iframe console for PAT, check network tab
- **Phase 4**: Prompt agent to generate data-fetching frame, verify correct imports and API calls

## Risks and open questions

### 1. Security: Plaintext PAT in window global

**Risk**: The PAT is injected as `window.__ARCADE_STUDIO_DEVREV_PAT__` in the iframe. Malicious frame code (or a compromised dependency) could exfiltrate it.

**Mitigation**: The frame is the data consumer — it NEEDS the PAT to call `/api/devrev/*`. This is an acceptable risk because:

- The designer writes the frame code (or reviews it before running)
- The PAT is user-scoped (only exposes the designer's own data, not org-wide data)
- PATs can be revoked instantly from DevRev's settings UI

**Future improvement** (out of scope for phase 1-5): Implement a "PAT proxy" pattern where the frame calls `/api/devrev/*` WITHOUT a header, and the middleware injects the PAT server-side by reading the slug from the request's Referer header. This prevents frame code from seeing the PAT. Tradeoff: more complex middleware (must parse Referer, handle missing Referer, etc.).

### 2. Caching: No server-side cache

**Risk**: The playground has a 60s in-memory cache on the client side. Studio's middleware is stateless (no cache). If frames make many identical requests, they may hit DevRev's rate limits.

**Mitigation**: For phase 1-5, we skip server-side caching. If rate limits become an issue in practice, we can add an LRU cache in a future phase. The cache key would be `${endpoint}:${JSON.stringify(args)}` (same as playground's client-side cache).

**Open question**: Should the cache be per-project (keyed by slug) or global (shared across all projects)? Per-project is simpler but wastes memory; global is more efficient but requires careful invalidation.

### 3. Rate limits: DevRev API throttling

**Risk**: DevRev's API may have rate limits (e.g., 100 requests/minute per user). Frames that fetch data in a loop or on every render could hit the limit.

**Mitigation**:

- The middleware already retries on 429 (rate limit exceeded) with exponential backoff
- The agent prompt (phase 4) should include a warning: "Only fetch DevRev data in `useEffect` with an empty dependency array (or explicit deps), never in the render body. Avoid polling or frequent re-fetching."
- If rate limits become a persistent issue, we can add a rate-limit warning banner in the frame (detect 429 responses and show an alert)

**Open question**: Should studio implement a client-side cache (like playground's 60s TTL cache) to reduce redundant requests? This would be a phase 6 enhancement.

### 4. OpenAPI drift

Helper scaffolded once. If DevRev API changes, designer re-scaffolds (delete helper, save PAT again) or manually edits. Future: auto-update from OpenAPI spec.

### 5. Cross-platform keychain

macOS Keychain via `keytar` (Linux/Windows deferred). Fallback: plaintext in `.secrets.json` if `keytar` fails.

### 6. PAT expiration

Settings UI has Validate button. Frame shows error on 401. Designer rotates PAT via Settings. Future: auto-detect 401, show banner.

### 7. Multi-org support

Per-project PAT requires re-entry for each project. Out of scope for v1. Future: global PAT pool with dropdown picker. (Deferred per YAGNI principle.)

### 8. Helper deletion

Idempotent scaffold logic. Designer re-scaffolds via Settings > Save. Future: auto-scaffold on startup if missing (low priority).

## Appendix: Playground comparison (5-line summary)

Playground uses DSL (`Query("devrev_list_works", ...)`) + localStorage PAT + tool-provider pattern. Studio uses plain React + macOS Keychain + generated helper module. Ported: middleware retry logic (`playground/vite.config.ts:134-197`), `cleanArgs`/`expandDotKeys` helpers, 14 endpoints. Not ported: DSL/tool specs (818 lines), `createDevRevToolProvider` (replaced by named exports in `shared/devrev.ts`), client-side cache (deferred).

---

## Summary

This plan provides a complete path from playground's DevRev integration to studio's per-project, React-native approach. The five phases are ordered by dependency (middleware → storage → frame integration → agent awareness → tests), with clear exit criteria and manual test scripts at each step. Security is addressed via macOS Keychain (phase 2), and the agent is taught via an augmented prompt (phase 4). The result: designers can prototype data-connected DevRev features in studio with the same ease as playground, but with better security and a simpler frame model.

---

## Revision history

**2026-04-24**: Resolved open decisions, trimmed verbose content for execution readiness. Locked decisions: (1) per-project PAT in keychain (keytar, fallback to `.secrets.json`), (2) stateless proxy middleware (port from playground), (3) generated `shared/devrev.ts` helper (no React hook), (4) DevRev section in `CLAUDE.md.tpl`, (5) Settings drawer in header (not sidebar), (6) multi-org out of scope for v1, (7) `DEVREV_PAT` env var escape hatch. Trimmed appendix to 5-line summary. Updated phase estimates (some preflight work already landed).
