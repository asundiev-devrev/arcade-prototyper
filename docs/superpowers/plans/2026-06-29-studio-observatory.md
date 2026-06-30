# Studio Observatory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bespoke, no-build dashboard over Studio's PostHog beta telemetry — beta health, latency, per-user drill-down, funnel — at a real URL, with live data and no key/PII ever in the browser or git.

**Architecture:** A Cloudflare Worker proxy holds the PostHog `phx_` key and an access-key allow-list as secrets; it maps named query requests to HogQL, calls PostHog, shapes the rows, and returns JSON. A static Cloudflare Pages site (vanilla HTML + CSS + Canvas, no build step) sends an access key and renders the JSON into tabs. Mirrors the existing Studio share Worker (`studio/worker/`) for auth/proxy and `~/ds-observatory-standalone` for the dashboard shell.

**Tech Stack:** TypeScript Cloudflare Worker (`wrangler`), vanilla JS + Canvas 2D dashboard, `vitest` for Worker-side unit tests, PostHog HogQL API.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-29-studio-observatory-dashboard-design.md` (in the arcade-prototyper repo).
- **New standalone repo** named `studio-observatory`. Holds NO key and NO data — secrets live only in Cloudflare; data is fetched live, never committed.
- **PostHog:** host `https://eu.posthog.com`, project id **197530**, endpoint `POST /api/projects/197530/query/`, body `{"query":{"kind":"HogQLQuery","query":"<sql>"}}`, header `Authorization: Bearer <phx_ key>`. Personal key (`phx_…`), NOT the project write key (`phc_…`). These come from the Worker env as `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_PERSONAL_KEY`.
- **Two Worker secrets:** `POSTHOG_PERSONAL_KEY` (the `phx_…`), `ACCESS_KEYS` (comma-separated allow-list of dashboard passwords). Set via `wrangler secret put`. Never logged, never returned to the browser.
- **`distinct_id` = user email.** App-version prop is `properties.version` (NOT `$app_version`, which is null).
- **exclude-me** = the `distinct_id != 'andrey.sundiev@devrev.ai'` clause. It is a toggle, **default OFF**.
- **Date ranges:** only `7`, `30`, `90` (days) are valid. Reject anything else.
- **Trends are date-bucketed** (`GROUP BY toDate(timestamp)`), never rolling-window snapshots.
- **Small-n honesty:** the dashboard shows raw `n`/fractions beside every percentage and percentile; this plan's shape layer therefore always returns the underlying counts, never just a ratio.
- **No build step on the dashboard** — `public/` is served as-is by Pages. Worker is the only thing `wrangler` compiles.
- All client `fetch` calls use **relative** paths (`/api/...` same-origin via a Pages Function route, or the Worker's absolute URL injected once) — never a hardcoded localhost.

---

## File Structure

```
studio-observatory/
  package.json            # scripts: dev (wrangler dev), deploy, test (vitest)
  wrangler.toml           # worker name, main, compatibility_date, [vars]
  tsconfig.json
  vitest.config.ts
  .gitignore              # node_modules, .dev.vars, dist
  .dev.vars.example       # POSTHOG_PERSONAL_KEY / ACCESS_KEYS for local `wrangler dev`
  README.md               # setup, secrets, deploy, auth flow
  worker/
    index.ts              # fetch handler: CORS, auth, route /api/q, error wrapping
    posthog.ts            # runHogql(env, sql) -> rows; the PostHog HTTP call
    queries.ts            # QUERIES registry: name -> (params) -> HogQL string
    shape.ts              # per-query: raw rows -> dashboard JSON section
    auth.ts               # checkBearer(req, env)
    event-catalog.json    # checked-in event/prop names, for the drift test
  public/
    index.html            # shell: tab nav, access-key gate, range/exclude controls
    app.js                # fetch /api/q, render tabs, wire controls
    charts.js             # Canvas helpers: lineChart, barChart, scatter
    render.js             # DOM helpers: kpiRow, table, errorCard, el()
    styles.css            # observatory visual style
  test/
    auth.test.ts
    queries.test.ts
    shape.test.ts
    fixtures/             # captured PostHog responses, one per query
```

**Task order & dependencies:**
- Tasks 1–6 build the Worker (data engine) and are strictly sequential.
- Tasks 7–8 build dashboard infrastructure (shell + helpers).
- Tasks 9–12 build the four tabs; each consumes a query+shape pair and the helpers, and can be reviewed independently.
- Task 13 is the deploy runbook.

---

### Task 1: Repo scaffold + tooling

**Files:**
- Create: `package.json`, `wrangler.toml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.dev.vars.example`, `README.md`, `worker/event-catalog.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm test` (vitest) and `pnpm dev` (wrangler) run; env var names `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_PERSONAL_KEY`, `ACCESS_KEYS`.

- [ ] **Step 1: Create the new repo directory and init git**

```bash
mkdir -p ~/studio-observatory/{worker,public,test/fixtures}
cd ~/studio-observatory
git init
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "studio-observatory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250109.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "wrangler": "^3.99.0"
  }
}
```

- [ ] **Step 3: Write `wrangler.toml`** (vars are non-secret; secrets are added later via CLI)

```toml
name = "studio-observatory"
main = "worker/index.ts"
compatibility_date = "2025-05-01"

[vars]
POSTHOG_HOST = "https://eu.posthog.com"
POSTHOG_PROJECT_ID = "197530"
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["worker", "test"]
}
```

- [ ] **Step 5: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 6: Write `.gitignore` and `.dev.vars.example`**

`.gitignore`:
```
node_modules/
.dev.vars
dist/
.wrangler/
```

`.dev.vars.example`:
```
POSTHOG_PERSONAL_KEY=phx_replace_me
# ACCESS_KEYS guards real PII (tester emails + event history). Use a generated
# high-entropy token, NOT a memorable passphrase: openssl rand -hex 24
ACCESS_KEYS=replace_with_openssl_rand_hex_24
```

- [ ] **Step 7: Write `worker/event-catalog.json`** — the checked-in list of every event + property the queries are allowed to reference (drift guard for Task 3's test)

```json
{
  "frame_generated": ["duration_ms", "ttft_ms", "num_turns", "model", "tokens_input", "tokens_output", "turn_type", "frame_lines", "version"],
  "generation_failed": ["duration_ms", "ttft_ms", "num_turns", "error_kind", "model", "version"],
  "frame_runtime_error": ["error_kind", "error_message", "frame_hash", "version"],
  "prompt_submitted": ["prompt_length", "prompt_text", "model", "frame_count_before", "version"],
  "share_opened": ["frame_count", "version"],
  "app_launched": ["version", "os", "os_version", "is_first_launch"]
}
```

- [ ] **Step 8: Write a minimal `README.md`** (expanded in Task 13)

```markdown
# Studio Observatory

Bespoke dashboard over Arcade Studio's PostHog beta telemetry.
Cloudflare Worker (holds the PostHog key + access keys) + static Pages dashboard.

## Dev
1. `pnpm install`
2. `cp .dev.vars.example .dev.vars` and fill in the real `phx_` key + an access key
3. `pnpm dev` — Worker on localhost; open `public/index.html` against it
4. `pnpm test`

Secrets are NEVER committed. See Task 13 / "Deploy" for production secrets.
```

- [ ] **Step 9: Install + commit**

```bash
cd ~/studio-observatory
pnpm install
git add -A
git commit -m "chore: scaffold studio-observatory (worker + pages, no build)"
```

Expected: `pnpm test` exits 0 with "No test files found" (acceptable at this stage); `pnpm install` succeeds.

---

### Task 2: Worker auth (`checkBearer`)

**Files:**
- Create: `worker/auth.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: env `{ ACCESS_KEYS: string }`.
- Produces: `export function checkBearer(req: Request, env: { ACCESS_KEYS: string }): Response | null` — returns a 401 `Response` when the key is missing/unknown, or `null` when authorized. `export function json(status: number, body: unknown): Response`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/auth.test.ts
import { describe, it, expect } from "vitest";
import { checkBearer } from "../worker/auth";

const env = { ACCESS_KEYS: "alpha,bravo" };
const reqWith = (auth?: string) =>
  new Request("https://x/api/q", auth ? { headers: { authorization: auth } } : {});

describe("checkBearer", () => {
  it("401s when the Authorization header is missing", () => {
    const r = checkBearer(reqWith(), env);
    expect(r?.status).toBe(401);
  });
  it("401s when the key is not in the allow-list", () => {
    const r = checkBearer(reqWith("Bearer nope"), env);
    expect(r?.status).toBe(401);
  });
  it("returns null (authorized) for a known key", () => {
    expect(checkBearer(reqWith("Bearer bravo"), env)).toBeNull();
  });
  it("trims whitespace in the allow-list", () => {
    expect(checkBearer(reqWith("Bearer alpha"), { ACCESS_KEYS: " alpha , bravo " })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/auth.test.ts`
Expected: FAIL — cannot find module `../worker/auth`.

- [ ] **Step 3: Write `worker/auth.ts`** (idiom copied from `studio/worker/src/index.ts` `checkBearer`)

```typescript
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function checkBearer(req: Request, env: { ACCESS_KEYS: string }): Response | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return json(401, { error: { code: "missing_key", message: "Missing Authorization: Bearer <access key>" } });
  }
  const provided = match[1].trim();
  const allowed = new Set((env.ACCESS_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean));
  if (!allowed.has(provided)) {
    return json(401, { error: { code: "invalid_key", message: "Access key not recognized" } });
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/auth.ts test/auth.test.ts
git commit -m "feat(worker): access-key bearer auth"
```

---

### Task 3: Named HogQL query builders (`queries.ts`)

**Files:**
- Create: `worker/queries.ts`
- Test: `test/queries.test.ts`

**Interfaces:**
- Consumes: nothing (pure strings).
- Produces:
  - `export type QueryParams = { range: 7 | 30 | 90; excludeMe: boolean; user?: string }`
  - `export const EXCLUDE_ME_ID = "andrey.sundiev@devrev.ai"`
  - `export function buildQuery(name: string, params: QueryParams): string` — throws `Error` on unknown name or invalid range.
  - `export const QUERY_NAMES: string[]` — the registry keys.
  - Query names used by later tasks: `"overview_kpis"`, `"activity_by_day"`, `"engagement"`, `"errors_by_version"`, `"latency_by_turn"`, `"latency_by_version"`, `"num_turns"`, `"duration_vs_tokens"`, `"ttft_trend"`, `"user_detail"`, `"funnel"`, `"version_spread"`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/queries.test.ts
import { describe, it, expect } from "vitest";
import { buildQuery, QUERY_NAMES, EXCLUDE_ME_ID } from "../worker/queries";
import catalog from "../worker/event-catalog.json";

describe("buildQuery", () => {
  it("substitutes the range", () => {
    const q = buildQuery("activity_by_day", { range: 30, excludeMe: false });
    expect(q).toContain("INTERVAL 30 DAY");
  });
  it("omits the exclude-me clause when excludeMe is false", () => {
    const q = buildQuery("engagement", { range: 7, excludeMe: false });
    expect(q).not.toContain(EXCLUDE_ME_ID);
  });
  it("adds the exclude-me clause when excludeMe is true", () => {
    const q = buildQuery("engagement", { range: 7, excludeMe: true });
    expect(q).toContain(`distinct_id != '${EXCLUDE_ME_ID}'`);
  });
  it("date-buckets the trend query", () => {
    const q = buildQuery("ttft_trend", { range: 90, excludeMe: false });
    expect(q).toContain("toDate(timestamp)");
  });
  it("rejects an invalid range", () => {
    expect(() => buildQuery("engagement", { range: 5 as any, excludeMe: false })).toThrow();
  });
  it("rejects an unknown query name", () => {
    expect(() => buildQuery("nope", { range: 7, excludeMe: false })).toThrow();
  });
  it("escapes the user param in user_detail (no raw quote injection)", () => {
    const q = buildQuery("user_detail", { range: 30, excludeMe: false, user: "a'b@x.com" });
    expect(q).toContain("a''b@x.com"); // single quotes doubled
  });

  // Drift guard: every properties.X referenced must be in the event catalog.
  it("references only catalogued properties", () => {
    const allProps = new Set(Object.values(catalog).flat());
    for (const name of QUERY_NAMES) {
      const q = buildQuery(name, { range: 30, excludeMe: false, user: "x@y.com" });
      for (const m of q.matchAll(/properties\.([a-z_]+)/g)) {
        expect(allProps, `${name} references properties.${m[1]}`).toContain(m[1]);
      }
    }
  });

  // PII denylist: NO query may pull raw prompt_text to the browser, even though
  // it exists in the catalog for drift-completeness. A future "show the prompt"
  // tweak would otherwise silently ship 2000-char prompt bodies past a shared key.
  it("never selects prompt_text", () => {
    for (const name of QUERY_NAMES) {
      const q = buildQuery(name, { range: 30, excludeMe: false, user: "x@y.com" });
      expect(q, `${name} must not reference prompt_text`).not.toContain("prompt_text");
    }
  });

  // Backslash-injection guard for the only attacker-controllable interpolation.
  it("escapes backslashes AND quotes in the user param", () => {
    const q = buildQuery("user_detail", { range: 30, excludeMe: false, user: "a\\'b" });
    expect(q).toContain("a\\\\''b"); // backslash doubled, then quote doubled
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/queries.test.ts`
Expected: FAIL — cannot find module `../worker/queries`.

- [ ] **Step 3: Write `worker/queries.ts`** (HogQL grounded in queries verified this session)

```typescript
export const EXCLUDE_ME_ID = "andrey.sundiev@devrev.ai";

export type QueryParams = { range: 7 | 30 | 90; excludeMe: boolean; user?: string };

const VALID_RANGES = new Set([7, 30, 90]);

/** Escape a string for safe inclusion inside a single-quoted HogQL literal.
 *  ClickHouse/HogQL treats BOTH backslash and single-quote as escape chars, so
 *  escape backslash FIRST (else doubling quotes can be undone by a trailing \). */
function lit(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/** The `AND distinct_id != '…'` fragment (or empty). */
function notMe(p: QueryParams): string {
  return p.excludeMe ? `AND distinct_id != '${EXCLUDE_ME_ID}'` : "";
}

type Builder = (p: QueryParams) => string;

const QUERIES: Record<string, Builder> = {
  overview_kpis: (p) => `
    SELECT
      count(DISTINCT distinct_id) AS active_users,
      countIf(event='frame_generated') AS generations,
      countIf(event='generation_failed') AS failures,
      round(quantile(0.5)(toFloatOrNull(properties.duration_ms))) AS dur_p50,
      round(quantile(0.5)(toFloatOrNull(properties.ttft_ms))) AS ttft_p50
    FROM events
    WHERE timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}`,

  activity_by_day: (p) => `
    SELECT toDate(timestamp) AS d,
      count(DISTINCT distinct_id) AS users,
      countIf(event='prompt_submitted') AS prompts,
      countIf(event='frame_generated') AS generations
    FROM events
    WHERE timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}
    GROUP BY d ORDER BY d`,

  engagement: (p) => `
    SELECT distinct_id,
      countIf(event='prompt_submitted') AS prompts,
      countIf(event='frame_generated') AS generated,
      countIf(event='generation_failed') AS failed,
      countIf(event='frame_runtime_error') AS crashes,
      countIf(event='share_opened') AS shares,
      max(timestamp) AS last_seen
    FROM events
    WHERE timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}
    GROUP BY distinct_id ORDER BY prompts DESC`,

  errors_by_version: (p) => `
    SELECT event, properties.version AS v, properties.error_kind AS kind, count() AS c
    FROM events
    WHERE event IN ('generation_failed','frame_runtime_error')
      AND timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}
    GROUP BY event, v, kind ORDER BY c DESC`,

  latency_by_turn: (p) => `
    SELECT properties.turn_type AS tt, count() AS n,
      round(quantile(0.5)(toFloatOrNull(properties.duration_ms))) AS dur_p50,
      round(quantile(0.9)(toFloatOrNull(properties.duration_ms))) AS dur_p90,
      round(max(toFloatOrNull(properties.duration_ms))) AS dur_max,
      round(quantile(0.5)(toFloatOrNull(properties.ttft_ms))) AS ttft_p50,
      round(quantile(0.9)(toFloatOrNull(properties.ttft_ms))) AS ttft_p90
    FROM events
    WHERE event='frame_generated' AND timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}
    GROUP BY tt ORDER BY n DESC`,

  latency_by_version: (p) => `
    SELECT properties.version AS v, properties.model AS model, count() AS n,
      round(quantile(0.5)(toFloatOrNull(properties.duration_ms))) AS dur_p50,
      round(quantile(0.5)(toFloatOrNull(properties.ttft_ms))) AS ttft_p50,
      round(quantile(0.5)(toFloatOrNull(properties.num_turns))) AS turns_p50
    FROM events
    WHERE event='frame_generated' AND timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}
    GROUP BY v, model ORDER BY n DESC`,

  num_turns: (p) => `
    SELECT toIntOrNull(properties.num_turns) AS turns, count() AS c
    FROM events
    WHERE event='frame_generated' AND timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}
    GROUP BY turns ORDER BY turns`,

  duration_vs_tokens: (p) => `
    SELECT toFloatOrNull(properties.duration_ms) AS dur, toFloatOrNull(properties.tokens_output) AS out,
      properties.turn_type AS tt
    FROM events
    WHERE event='frame_generated' AND properties.duration_ms IS NOT NULL
      AND timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}`,

  ttft_trend: (p) => `
    SELECT toDate(timestamp) AS d,
      round(quantile(0.5)(toFloatOrNull(properties.ttft_ms))) AS ttft_p50,
      round(quantile(0.5)(toFloatOrNull(properties.duration_ms))) AS dur_p50,
      count() AS n
    FROM events
    WHERE event='frame_generated' AND timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}
    GROUP BY d ORDER BY d`,

  funnel: (p) => `
    SELECT
      count(DISTINCT if(event='app_launched', distinct_id, NULL)) AS launched,
      count(DISTINCT if(event='prompt_submitted', distinct_id, NULL)) AS prompted,
      count(DISTINCT if(event='frame_generated', distinct_id, NULL)) AS generated,
      count(DISTINCT if(event='share_opened', distinct_id, NULL)) AS shared
    FROM events
    WHERE timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}`,

  version_spread: (p) => `
    SELECT properties.version AS v, count(DISTINCT distinct_id) AS users, count() AS events
    FROM events
    WHERE event='app_launched' AND timestamp > now() - INTERVAL ${p.range} DAY ${notMe(p)}
    GROUP BY v ORDER BY events DESC`,

  user_detail: (p) => `
    SELECT event, properties.version AS v, properties.error_message AS msg,
      properties.error_kind AS kind, toDateTime(timestamp) AS ts
    FROM events
    WHERE distinct_id = '${lit(p.user ?? "")}'
      AND timestamp > now() - INTERVAL ${p.range} DAY
    ORDER BY timestamp DESC LIMIT 200`,
};

export const QUERY_NAMES = Object.keys(QUERIES);

export function buildQuery(name: string, params: QueryParams): string {
  if (!VALID_RANGES.has(params.range)) throw new Error(`invalid range: ${params.range}`);
  const builder = QUERIES[name];
  if (!builder) throw new Error(`unknown query: ${name}`);
  return builder(params).trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/queries.test.ts`
Expected: PASS (10 tests — incl. drift guard, prompt_text denylist, backslash-escape).

- [ ] **Step 5: Commit**

```bash
git add worker/queries.ts test/queries.test.ts
git commit -m "feat(worker): named HogQL builders with range/exclude-me + drift guard"
```

---

### Task 4: Row shaping (`shape.ts`)

**Files:**
- Create: `worker/shape.ts`
- Test: `test/shape.test.ts`, `test/fixtures/*.json`

**Interfaces:**
- Consumes: PostHog response rows. PostHog returns `{ results: any[][], columns: string[] }`. The shaper receives `{ columns, results }`.
- Produces: `export function shape(name: string, raw: { columns: string[]; results: any[][] }): unknown` — converts a query's row-arrays into named objects keyed by `columns`, plus a couple of derived shapes the dashboard needs. Unknown name → passthrough rows-as-objects.
- Helper produced for tests: `export function rowsToObjects(raw): Record<string, any>[]`.

- [ ] **Step 1: Capture a fixture** — save one real PostHog response per query name into `test/fixtures/<name>.json`. (During implementation, run each query through the Worker once with a valid key and save the JSON; until then, hand-author minimal fixtures matching the column lists in Task 3.) Example `test/fixtures/engagement.json`:

```json
{
  "columns": ["distinct_id", "prompts", "generated", "failed", "crashes", "shares", "last_seen"],
  "results": [
    ["nuska.trost@devrev.ai", 25, 13, 5, 16, 0, "2026-06-18T04:32:14Z"],
    ["gil.zissu@devrev.ai", 0, 0, 0, 0, 0, "2026-06-29T07:33:17Z"]
  ]
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// test/shape.test.ts
import { describe, it, expect } from "vitest";
import { shape, rowsToObjects } from "../worker/shape";
import engagement from "./fixtures/engagement.json";

describe("rowsToObjects", () => {
  it("zips columns + results into named objects", () => {
    const out = rowsToObjects(engagement as any);
    expect(out[0].distinct_id).toBe("nuska.trost@devrev.ai");
    expect(out[0].prompts).toBe(25);
  });
});

describe("shape: engagement", () => {
  it("returns rows untouched (already object-shaped)", () => {
    const out = shape("engagement", engagement as any) as any[];
    expect(out).toHaveLength(2);
    expect(out[1].distinct_id).toBe("gil.zissu@devrev.ai");
  });
});

describe("shape: overview_kpis", () => {
  it("returns a single object, not an array of one", () => {
    const raw = { columns: ["active_users","generations","failures","dur_p50","ttft_p50"], results: [[6, 27, 9, 41000, 6900]] };
    const out = shape("overview_kpis", raw) as any;
    expect(out.active_users).toBe(6);
    expect(out.ttft_p50).toBe(6900);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test test/shape.test.ts`
Expected: FAIL — cannot find module `../worker/shape`.

- [ ] **Step 4: Write `worker/shape.ts`**

```typescript
type Raw = { columns: string[]; results: any[][] };

export function rowsToObjects(raw: Raw): Record<string, any>[] {
  const cols = raw?.columns ?? [];
  return (raw?.results ?? []).map((row) => {
    const obj: Record<string, any> = {};
    cols.forEach((c, i) => { obj[c] = row[i]; });
    return obj;
  });
}

/** Queries that semantically return ONE row -> return the object, not [object]. */
const SINGLE_ROW = new Set(["overview_kpis", "funnel"]);

export function shape(name: string, raw: Raw): unknown {
  const rows = rowsToObjects(raw);
  if (SINGLE_ROW.has(name)) return rows[0] ?? {};
  return rows;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test test/shape.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/shape.ts test/shape.test.ts test/fixtures/
git commit -m "feat(worker): shape PostHog rows into dashboard JSON"
```

---

### Task 5: PostHog HTTP call (`posthog.ts`)

**Files:**
- Create: `worker/posthog.ts`
- Test: `test/posthog.test.ts`

**Interfaces:**
- Consumes: env `{ POSTHOG_HOST: string; POSTHOG_PROJECT_ID: string; POSTHOG_PERSONAL_KEY: string }`, an SQL string, and a `fetch` impl (injectable for tests).
- Produces: `export async function runHogql(env, sql, fetchImpl?): Promise<{ columns: string[]; results: any[][] }>` — POSTs to the PostHog query endpoint and returns the raw shape; throws `Error` on non-2xx.

- [ ] **Step 1: Write the failing test**

```typescript
// test/posthog.test.ts
import { describe, it, expect, vi } from "vitest";
import { runHogql } from "../worker/posthog";

const env = { POSTHOG_HOST: "https://eu.posthog.com", POSTHOG_PROJECT_ID: "197530", POSTHOG_PERSONAL_KEY: "phx_test" };

describe("runHogql", () => {
  it("POSTs HogQL to the project query endpoint with the bearer key", async () => {
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      expect(url).toBe("https://eu.posthog.com/api/projects/197530/query/");
      expect(init.headers.authorization).toBe("Bearer phx_test");
      expect(JSON.parse(init.body).query.query).toContain("SELECT 1");
      return new Response(JSON.stringify({ columns: ["x"], results: [[1]] }), { status: 200 });
    });
    const out = await runHogql(env, "SELECT 1", fetchImpl as any);
    expect(out.results[0][0]).toBe(1);
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 400 }));
    await expect(runHogql(env, "SELECT 1", fetchImpl as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/posthog.test.ts`
Expected: FAIL — cannot find module `../worker/posthog`.

- [ ] **Step 3: Write `worker/posthog.ts`**

```typescript
export interface PostHogEnv {
  POSTHOG_HOST: string;
  POSTHOG_PROJECT_ID: string;
  POSTHOG_PERSONAL_KEY: string;
}

export async function runHogql(
  env: PostHogEnv,
  sql: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ columns: string[]; results: any[][] }> {
  const url = `${env.POSTHOG_HOST}/api/projects/${env.POSTHOG_PROJECT_ID}/query/`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.POSTHOG_PERSONAL_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PostHog ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { columns?: string[]; results?: any[][] };
  return { columns: data.columns ?? [], results: data.results ?? [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/posthog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/posthog.ts test/posthog.test.ts
git commit -m "feat(worker): PostHog HogQL HTTP client"
```

---

### Task 6: Worker fetch handler (`index.ts`)

**Files:**
- Create: `worker/index.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Consumes: `checkBearer`, `json` (auth.ts); `buildQuery`, `QueryParams` (queries.ts); `runHogql` (posthog.ts); `shape` (shape.ts).
- Produces: a Worker `fetch` handler. Routes: `GET /api/q?name=<n>&range=<7|30|90>&excludeMe=<0|1>&user=<email>`. Returns `{ data }` on success or `{ error }` (per-section). Default export `{ fetch }`. Exports `handle(req, env, fetchImpl?)` for testing.

- [ ] **Step 1: Write the failing test**

```typescript
// test/index.test.ts
import { describe, it, expect, vi } from "vitest";
import { handle } from "../worker/index";

const env = {
  ACCESS_KEYS: "secret",
  POSTHOG_HOST: "https://eu.posthog.com",
  POSTHOG_PROJECT_ID: "197530",
  POSTHOG_PERSONAL_KEY: "phx_test",
};
const okFetch = vi.fn(async () => new Response(JSON.stringify({ columns: ["active_users","generations","failures","dur_p50","ttft_p50"], results: [[6,27,9,41000,6900]] }), { status: 200 }));
const url = (qs: string) => new Request(`https://w/api/q?${qs}`, { headers: { authorization: "Bearer secret" } });

describe("worker handle", () => {
  it("401s without a valid access key", async () => {
    const r = await handle(new Request("https://w/api/q?name=overview_kpis&range=30"), env, okFetch as any);
    expect(r.status).toBe(401);
  });
  it("returns shaped data for a valid request", async () => {
    const r = await handle(url("name=overview_kpis&range=30&excludeMe=0"), env, okFetch as any);
    const body = await r.json() as any;
    expect(body.data.active_users).toBe(6);
  });
  it("400s on an unknown query name", async () => {
    const r = await handle(url("name=bogus&range=30"), env, okFetch as any);
    expect(r.status).toBe(400);
  });
  it("400s on an invalid range", async () => {
    const r = await handle(url("name=overview_kpis&range=5"), env, okFetch as any);
    expect(r.status).toBe(400);
  });
  it("surfaces a PostHog failure as a 502 error body, not a throw", async () => {
    const badFetch = vi.fn(async () => new Response("boom", { status: 500 }));
    const r = await handle(url("name=overview_kpis&range=30"), env, badFetch as any);
    expect(r.status).toBe(502);
    expect((await r.json() as any).error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/index.test.ts`
Expected: FAIL — cannot find module `../worker/index`.

- [ ] **Step 3: Write `worker/index.ts`**

```typescript
import { checkBearer, json } from "./auth";
import { buildQuery, type QueryParams } from "./queries";
import { runHogql, type PostHogEnv } from "./posthog";
import { shape } from "./shape";

export interface Env extends PostHogEnv {
  ACCESS_KEYS: string;
  ALLOWED_ORIGIN?: string; // the Pages origin; falls back to "*" only if unset
}

function cors(res: Response, env: Env): Response {
  // Lock CORS to the dashboard's own Pages origin — we control both ends, so
  // there's no reason for "*". This is defence-in-depth behind the access key:
  // it stops an arbitrary third-party page from calling the Worker from a
  // browser. ALLOWED_ORIGIN is set as a wrangler [var] at deploy time.
  res.headers.set("access-control-allow-origin", env.ALLOWED_ORIGIN || "*");
  res.headers.set("vary", "origin");
  res.headers.set("access-control-allow-headers", "authorization, content-type");
  res.headers.set("access-control-allow-methods", "GET, OPTIONS");
  res.headers.set("access-control-max-age", "86400");
  return res;
}

export async function handle(req: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }), env);

  const url = new URL(req.url);
  if (url.pathname !== "/api/q") {
    return cors(json(404, { error: { code: "not_found", message: "GET /api/q only" } }), env);
  }

  const auth = checkBearer(req, env);
  if (auth) return cors(auth, env);

  const name = url.searchParams.get("name") ?? "";
  const range = Number(url.searchParams.get("range") ?? "30") as QueryParams["range"];
  const excludeMe = url.searchParams.get("excludeMe") === "1";
  const user = url.searchParams.get("user") ?? undefined;

  let sql: string;
  try {
    sql = buildQuery(name, { range, excludeMe, user });
  } catch (e) {
    return cors(json(400, { error: { code: "bad_query", message: String((e as Error).message) } }), env);
  }

  try {
    const raw = await runHogql(env, sql, fetchImpl);
    return cors(json(200, { data: shape(name, raw) }), env);
  } catch (e) {
    return cors(json(502, { error: { code: "posthog_error", message: String((e as Error).message) } }), env);
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/index.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Smoke-test the Worker locally**

```bash
cp .dev.vars.example .dev.vars   # fill in the real phx_ key + access key
pnpm dev
# in another shell:
curl -s "http://localhost:8787/api/q?name=overview_kpis&range=30&excludeMe=1" -H "Authorization: Bearer <your-access-key>"
```
Expected: JSON `{ "data": { "active_users": <n>, ... } }`.

- [ ] **Step 6: Commit**

```bash
git add worker/index.ts test/index.test.ts
git commit -m "feat(worker): /api/q route — auth, build, query, shape, error wrapping"
```

---

### Task 7: Dashboard shell (`index.html` + `styles.css` + access-key gate)

**Files:**
- Create: `public/index.html`, `public/styles.css`

**Interfaces:**
- Consumes: nothing yet (app.js wired in Task 8).
- Produces: DOM landmarks app.js binds to — `#access-gate`, `#access-input`, `#access-save`, `#app`, `#tabs`, `#tab-content`, `#range-select`, `#exclude-toggle`, `#filter-note`. A global `<script>` defining `window.OBSERVATORY_API` (the Worker base URL).

- [ ] **Step 1: Invoke the visual-style skill**

Run the `observatory-dashboard-style` skill (installed) to load the Observatory tokens (Chip fonts, phi spacing, KPI/card vocabulary, Canvas chart conventions). Apply its tokens in `styles.css`. Reference: `~/ds-observatory-standalone/src/dashboard/styles.css` + `design.md`.

- [ ] **Step 2: Write `public/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Studio Observatory</title>
  <link rel="stylesheet" href="./styles.css" />
  <script>
    // Worker base URL. Same-origin in production if Pages + Worker share a
    // route; otherwise set to the deployed Worker URL. Overridable for local dev.
    window.OBSERVATORY_API = localStorage.getItem("observatory_api") || "";
  </script>
</head>
<body>
  <section id="access-gate" hidden>
    <div class="gate-card">
      <h1>Studio Observatory</h1>
      <p>Enter your access key.</p>
      <input id="access-input" type="password" autocomplete="off" />
      <button id="access-save">Enter</button>
      <p id="access-error" class="error" hidden></p>
    </div>
  </section>

  <main id="app" hidden>
    <header class="topbar">
      <h1>Studio Observatory</h1>
      <div class="controls">
        <label>Range
          <select id="range-select">
            <option value="7">7d</option>
            <option value="30" selected>30d</option>
            <option value="90">90d</option>
          </select>
        </label>
        <label><input type="checkbox" id="exclude-toggle" /> Exclude me</label>
        <span id="filter-note" class="muted"></span>
      </div>
      <nav id="tabs"></nav>
    </header>
    <div id="tab-content"></div>
  </main>

  <script src="./charts.js"></script>
  <script src="./render.js"></script>
  <script src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `public/styles.css`** — apply the Observatory tokens from Step 1 (Chip font stack, phi-based spacing scale, KPI grid, card surfaces, muted/error colors, table styling, tab bar). Include `#access-gate` centered card styling and `[hidden]{display:none}`. (Token *values* come from the skill; this file is otherwise pure CSS.)

  **Load-bearing (not decorative):** the cards and the chart canvas MUST have an explicit width or the charts render blank (`charts.js setup()` reads the parent's `clientWidth`). Include at minimum:

```css
.card { width: 100%; box-sizing: border-box; padding: 16px; }
.chart { display: block; width: 100%; height: 220px; }
#tab-content { max-width: 1100px; margin: 0 auto; }
```

- [ ] **Step 4: Manual check**

Open `public/index.html` directly in a browser. Expected: the access gate renders centered (since `#app` is hidden and gate is shown by app.js in Task 8 — for now both have `hidden`, so a blank page is fine; verify no console errors and fonts load).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "feat(dashboard): shell + access gate + observatory styles"
```

---

### Task 8: Dashboard core (`render.js`, `charts.js`, `app.js` wiring + Overview tab)

**Files:**
- Create: `public/render.js`, `public/charts.js`, `public/app.js`

**Interfaces:**
- Consumes: Worker `/api/q`; DOM landmarks from Task 7.
- Produces (globals, since no-build/no-modules):
  - `window.el(tag, attrs, children)` — DOM helper.
  - `window.kpiRow(items)` where `items: {label, value, sub?}[]` → KPI grid element.
  - `window.table(headers, rows)` → sortable table element.
  - `window.errorCard(message)`, `window.noData()` → cards.
  - `window.fmtPct(n, d)` → `"67% (4/6)"`; `window.fmtMs(ms)`; `window.fmtNum(n)`; `window.fmtDate(iso)`.
  - `window.charts.lineChart(canvas, series)`, `window.charts.barChart(canvas, bars)`, `window.charts.scatter(canvas, points)`.
  - `window.api(name, extra?)` → `fetch` wrapper that adds the access key + range + excludeMe, returns `data` or throws.
  - `window.registerTab(id, label, renderFn)` and a tab runtime.

- [ ] **Step 1: Write `public/render.js`** (DOM + formatting helpers; pattern from `~/ds-observatory-standalone/src/dashboard/app.js` `el`, `pct`, `fmt*`)

```javascript
(function () {
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    if (children != null) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function fmtNum(n) { return (n == null ? 0 : n).toLocaleString(); }
  function fmtPct(n, d) { return d ? Math.round((n / d) * 1000) / 10 + "% (" + n + "/" + d + ")" : "—"; }
  function fmtMs(ms) { if (ms == null) return "—"; var s = ms / 1000; return s < 60 ? s.toFixed(1) + "s" : Math.floor(s / 60) + "m " + Math.round(s % 60) + "s"; }
  function fmtDate(iso) { if (!iso) return "—"; var d = new Date(iso); return d.toISOString().slice(0, 10); }

  function kpiRow(items) {
    return el("div", { class: "kpi-row" }, items.map(function (it) {
      return el("div", { class: "kpi" }, [
        el("div", { class: "kpi-value" }, String(it.value)),
        el("div", { class: "kpi-label" }, it.label),
        it.sub ? el("div", { class: "kpi-sub muted" }, it.sub) : null,
      ]);
    }));
  }
  function table(headers, rows) {
    var thead = el("tr", null, headers.map(function (h) { return el("th", null, h); }));
    var trs = rows.map(function (r) { return el("tr", null, r.map(function (c) { return el("td", null, typeof c === "string" || typeof c === "number" ? String(c) : c); })); });
    return el("table", { class: "data-table" }, [el("thead", null, thead), el("tbody", null, trs)]);
  }
  function errorCard(msg) { return el("div", { class: "card error-card" }, "Couldn’t load: " + msg); }
  function noData() { return el("div", { class: "card muted" }, "No data for this range."); }

  window.el = el; window.fmtNum = fmtNum; window.fmtPct = fmtPct; window.fmtMs = fmtMs; window.fmtDate = fmtDate;
  window.kpiRow = kpiRow; window.table = table; window.errorCard = errorCard; window.noData = noData;
})();
```

- [ ] **Step 2: Write `public/charts.js`** (Canvas 2D; line + bar + scatter, following the Observatory chart conventions from the style skill)

```javascript
(function () {
  function setup(canvas) {
    // Width comes from the PARENT (a freshly-inserted canvas has clientWidth 0
    // until it has a CSS box), with a fallback — mirrors the reference's
    // setupCanvas. We also SET canvas.style.{width,height} so the element has a
    // display box independent of the dpr-scaled backing store. Charts must be
    // (re)drawn while their tab is visible (see selectTab) or width is 0.
    var dpr = window.devicePixelRatio || 1;
    var parent = canvas.parentElement;
    var w = (parent && parent.clientWidth) || canvas.clientWidth || 800;
    var h = 220;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    return { ctx: ctx, w: w, h: h };
  }
  function lineChart(canvas, series) {
    // series: [{ label, color, points: [{x: isoDate, y: number}] }]
    var s = setup(canvas), ctx = s.ctx, pad = 28;
    var all = series.flatMap(function (ser) { return ser.points.map(function (p) { return p.y; }); });
    var maxY = Math.max(1, Math.max.apply(null, all.length ? all : [1]));
    var n = Math.max.apply(null, series.map(function (ser) { return ser.points.length; }).concat([1]));
    series.forEach(function (ser) {
      ctx.strokeStyle = ser.color; ctx.lineWidth = 2; ctx.beginPath();
      ser.points.forEach(function (p, i) {
        var x = pad + (i / Math.max(1, n - 1)) * (s.w - pad * 2);
        var y = s.h - pad - (p.y / maxY) * (s.h - pad * 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }
  function barChart(canvas, bars) {
    // bars: [{ label, value, color? }]
    var s = setup(canvas), ctx = s.ctx, pad = 28;
    var maxV = Math.max(1, Math.max.apply(null, bars.map(function (b) { return b.value; }).concat([1])));
    var bw = (s.w - pad * 2) / Math.max(1, bars.length);
    bars.forEach(function (b, i) {
      var bh = (b.value / maxV) * (s.h - pad * 2);
      ctx.fillStyle = b.color || "#6b5bd2";
      ctx.fillRect(pad + i * bw + 4, s.h - pad - bh, bw - 8, bh);
    });
  }
  function scatter(canvas, points) {
    // points: [{ x, y }]
    var s = setup(canvas), ctx = s.ctx, pad = 28;
    var maxX = Math.max(1, Math.max.apply(null, points.map(function (p) { return p.x; }).concat([1])));
    var maxY = Math.max(1, Math.max.apply(null, points.map(function (p) { return p.y; }).concat([1])));
    ctx.fillStyle = "rgba(107,91,210,0.6)";
    points.forEach(function (p) {
      var x = pad + (p.x / maxX) * (s.w - pad * 2);
      var y = s.h - pad - (p.y / maxY) * (s.h - pad * 2);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });
  }
  window.charts = { lineChart: lineChart, barChart: barChart, scatter: scatter };
})();
```

- [ ] **Step 3: Write `public/app.js`** — access gate, `api()`, tab runtime, controls wiring, and the **Overview** tab

```javascript
(function () {
  var KEY = "observatory_access_key";
  var state = { range: 30, excludeMe: false };
  var TABS = []; // { id, label, render }

  function api(name, extra) {
    var base = window.OBSERVATORY_API || "";
    var qs = "name=" + encodeURIComponent(name) + "&range=" + state.range + "&excludeMe=" + (state.excludeMe ? 1 : 0);
    if (extra) Object.keys(extra).forEach(function (k) { qs += "&" + k + "=" + encodeURIComponent(extra[k]); });
    return fetch(base + "/api/q?" + qs, { headers: { authorization: "Bearer " + (localStorage.getItem(KEY) || "") } })
      .then(function (r) {
        if (r.status === 401) { showGate("Access key rejected."); throw new Error("unauthorized"); }
        return r.json();
      })
      .then(function (body) { if (body.error) throw new Error(body.error.message); return body.data; });
  }
  window.api = api;

  function registerTab(id, label, render) { TABS.push({ id: id, label: label, render: render }); }
  window.registerTab = registerTab;

  function showGate(msg) {
    document.getElementById("app").hidden = true;
    var gate = document.getElementById("access-gate"); gate.hidden = false;
    var err = document.getElementById("access-error"); err.hidden = !msg; if (msg) err.textContent = msg;
  }
  function showApp() {
    document.getElementById("access-gate").hidden = true;
    document.getElementById("app").hidden = false;
    renderTabs(); selectTab(TABS[0].id);
  }
  function renderTabs() {
    var nav = document.getElementById("tabs"); nav.innerHTML = "";
    TABS.forEach(function (t) {
      nav.appendChild(window.el("button", { class: "tab", "data-id": t.id, onclick: function () { selectTab(t.id); } }, t.label));
    });
  }
  function selectTab(id) {
    // Single source of truth for the active tab: state.activeTab. selectTab both
    // records it AND owns the .active class — the boot path calls selectTab
    // programmatically (no click), so class-toggling must NOT live in a click
    // listener or the first paint has no active tab and refresh() misfires.
    state.activeTab = id;
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-id") === id);
    });
    var host = document.getElementById("tab-content"); host.innerHTML = "";
    var tab = TABS.filter(function (t) { return t.id === id; })[0];
    var loading = window.el("div", { class: "muted" }, "Loading…"); host.appendChild(loading);
    Promise.resolve(tab.render(host)).then(function () { if (loading.parentNode) loading.remove(); })
      .catch(function (e) { host.innerHTML = ""; host.appendChild(window.errorCard(e.message)); });
  }
  function refresh() { selectTab(state.activeTab || TABS[0].id); }

  // ---- Overview tab ----
  registerTab("overview", "Overview", function (host) {
    return Promise.all([api("overview_kpis"), api("activity_by_day"), api("engagement"), api("errors_by_version")])
      .then(function (res) {
        var k = res[0], days = res[1], eng = res[2], errs = res[3];
        host.appendChild(window.kpiRow([
          { label: "Active users", value: window.fmtNum(k.active_users) },
          { label: "Generations", value: window.fmtNum(k.generations) },
          // generated and failed are DISJOINT event types (emitted in an
          // if/else per turn), so success rate = generated / (generated+failed),
          // NOT generated-failed (which can go negative).
          { label: "Success rate", value: window.fmtPct(k.generations, k.generations + k.failures) },
          { label: "Median duration", value: window.fmtMs(k.dur_p50) },
          { label: "Median ttft", value: window.fmtMs(k.ttft_p50) },
        ]));
        var canvas = window.el("canvas", { class: "chart" });
        host.appendChild(window.el("div", { class: "card" }, [window.el("h3", null, "Activity by day"), canvas]));
        window.charts.lineChart(canvas, [
          { label: "users", color: "#6b5bd2", points: days.map(function (d) { return { x: d.d, y: d.users }; }) },
          { label: "prompts", color: "#3aa6a0", points: days.map(function (d) { return { x: d.d, y: d.prompts }; }) },
          { label: "generations", color: "#d2785b", points: days.map(function (d) { return { x: d.d, y: d.generations }; }) },
        ]);
        host.appendChild(window.el("div", { class: "card" }, [
          window.el("h3", null, "Engagement (" + eng.length + " users)"),
          window.table(["User", "Prompts", "Generated", "Failed", "Crashes", "Shares", "Last seen"],
            eng.map(function (u) { return [u.distinct_id, u.prompts, u.generated, u.failed, u.crashes, u.shares, window.fmtDate(u.last_seen)]; })),
        ]));
        host.appendChild(window.el("div", { class: "card" }, [
          window.el("h3", null, "Errors by version"),
          window.table(["Event", "Version", "Kind", "Count"],
            errs.map(function (e) { return [e.event, e.v, e.kind, e.c]; })),
        ]));
      });
  });

  // ---- controls + boot ----
  document.getElementById("access-save").addEventListener("click", function () {
    var v = document.getElementById("access-input").value.trim();
    if (!v) return;
    localStorage.setItem(KEY, v);
    api("overview_kpis").then(showApp).catch(function () {}); // showGate already fired on 401
  });
  document.getElementById("range-select").addEventListener("change", function (e) { state.range = Number(e.target.value); refresh(); });
  document.getElementById("exclude-toggle").addEventListener("change", function (e) {
    state.excludeMe = e.target.checked;
    document.getElementById("filter-note").textContent = e.target.checked ? "excluding andrey.sundiev@devrev.ai" : "";
    refresh();
  });
  // (active-tab class is owned by selectTab — no separate click listener.)

  if (localStorage.getItem(KEY)) api("overview_kpis").then(showApp).catch(function () {}); else showGate();
})();
```

- [ ] **Step 4: Write the dashboard smoke test** (the spec requires one; jsdom env). `render.js` exposes its helpers as `window.*` via an IIFE — load it into jsdom by evaluating the file, then assert the pure render helpers produce the expected DOM from a fixture.

```typescript
// test/render.smoke.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

beforeAll(() => {
  // Execute render.js in the jsdom global so window.el/kpiRow/table/fmt* exist.
  // eslint-disable-next-line no-eval
  (0, eval)(readFileSync(new URL("../public/render.js", import.meta.url), "utf-8"));
});

describe("render helpers", () => {
  it("fmtPct shows the raw fraction (small-n honesty)", () => {
    expect((window as any).fmtPct(4, 6)).toBe("66.7% (4/6)");
    expect((window as any).fmtPct(1, 0)).toBe("—");
  });
  it("kpiRow renders one .kpi per item with value + label", () => {
    const node = (window as any).kpiRow([{ label: "Active users", value: 6 }]);
    expect(node.querySelectorAll(".kpi").length).toBe(1);
    expect(node.querySelector(".kpi-value")!.textContent).toBe("6");
    expect(node.querySelector(".kpi-label")!.textContent).toBe("Active users");
  });
  it("table renders a header row + one row per data row", () => {
    const node = (window as any).table(["User", "Prompts"], [["nuska@x", 25]]);
    expect(node.querySelectorAll("thead th").length).toBe(2);
    expect(node.querySelectorAll("tbody tr").length).toBe(1);
    expect(node.querySelector("tbody td")!.textContent).toBe("nuska@x");
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `pnpm test test/render.smoke.test.ts`
Expected: PASS (3 tests). (If `fmtPct(4,6)` rounds to `66.7`, the assertion matches; adjust the expected string to the helper's actual rounding if needed.)

- [ ] **Step 6: Manual smoke test**

With `pnpm dev` running and `window.OBSERVATORY_API` set to `http://localhost:8787` (via `localStorage.setItem("observatory_api","http://localhost:8787")` in the console), open `public/index.html`. Enter the access key. Expected: Overview renders KPIs, the activity line chart (NOT blank — verify the canvas has non-zero width), the engagement table, the errors table. Toggling range/exclude re-fetches and stays on the current tab.

- [ ] **Step 7: Commit**

```bash
git add public/render.js public/charts.js public/app.js test/render.smoke.test.ts
git commit -m "feat(dashboard): core helpers, charts, tab runtime + Overview tab + smoke test"
```

---

### Task 9: Latency tab

**Files:**
- Modify: `public/app.js` (append a `registerTab("latency", ...)` block)

**Interfaces:**
- Consumes: `api("latency_by_turn")`, `api("latency_by_version")`, `api("num_turns")`, `api("duration_vs_tokens")`, `api("ttft_trend")`; the render/chart helpers.
- Produces: nothing downstream.

- [ ] **Step 1: Append the Latency tab** to `public/app.js` (after the Overview block, before controls). Follows the Overview pattern exactly: `registerTab`, `Promise.all`, build cards.

```javascript
registerTab("latency", "Latency", function (host) {
  return Promise.all([api("latency_by_turn"), api("latency_by_version"), api("num_turns"), api("duration_vs_tokens"), api("ttft_trend")])
    .then(function (res) {
      var byTurn = res[0], byVer = res[1], turns = res[2], scatterPts = res[3], trend = res[4];

      host.appendChild(window.el("div", { class: "card" }, [
        window.el("h3", null, "Latency by turn type"),
        window.table(["Turn", "n", "ttft p50", "ttft p90", "dur p50", "dur p90", "dur max"],
          byTurn.map(function (r) { return [
            r.tt, r.n, window.fmtMs(r.ttft_p50), window.fmtMs(r.ttft_p90),
            window.fmtMs(r.dur_p50), window.fmtMs(r.dur_p90), window.fmtMs(r.dur_max),
          ]; })),
        window.el("p", { class: "muted" }, "Rows with n<5 are noisy — read as directional."),
      ]));

      host.appendChild(window.el("div", { class: "card" }, [
        window.el("h3", null, "By version + model"),
        window.table(["Version", "Model", "n", "ttft p50", "dur p50", "turns p50"],
          byVer.map(function (r) { return [r.v, r.model, r.n, window.fmtMs(r.ttft_p50), window.fmtMs(r.dur_p50), r.turns_p50]; })),
      ]));

      var turnsCanvas = window.el("canvas", { class: "chart" });
      host.appendChild(window.el("div", { class: "card" }, [window.el("h3", null, "num_turns distribution"), turnsCanvas]));
      window.charts.barChart(turnsCanvas, turns.map(function (t) { return { label: String(t.turns), value: t.c }; }));

      var trendCanvas = window.el("canvas", { class: "chart" });
      host.appendChild(window.el("div", { class: "card" }, [window.el("h3", null, "ttft + duration p50 by day"), trendCanvas]));
      window.charts.lineChart(trendCanvas, [
        { label: "ttft p50", color: "#6b5bd2", points: trend.map(function (d) { return { x: d.d, y: d.ttft_p50 }; }) },
        { label: "dur p50", color: "#d2785b", points: trend.map(function (d) { return { x: d.d, y: d.dur_p50 }; }) },
      ]);

      var sc = window.el("canvas", { class: "chart" });
      host.appendChild(window.el("div", { class: "card" }, [window.el("h3", null, "Duration vs output tokens (n=" + scatterPts.length + ")"), sc]));
      window.charts.scatter(sc, scatterPts.map(function (p) { return { x: p.out, y: p.dur }; }));
    });
});
```

- [ ] **Step 2: Manual smoke test** — open the dashboard, click **Latency**. Expected: turn-type table (with n column), version/model table, num_turns bar chart, ttft/dur trend line, duration-vs-tokens scatter. No console errors.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): Latency tab — percentiles, turns, trend, scatter"
```

---

### Task 10: Users tab (per-tester drill-down)

**Files:**
- Modify: `public/app.js` (append `registerTab("users", ...)`)

**Interfaces:**
- Consumes: `api("engagement")` (for the user list) and `api("user_detail", { user })`; render helpers.
- Produces: nothing downstream.

- [ ] **Step 1: Append the Users tab** to `public/app.js`. A user picker (from the engagement list) + a detail panel that loads `user_detail` on selection.

```javascript
registerTab("users", "Users", function (host) {
  return api("engagement").then(function (users) {
    var detail = window.el("div", { class: "card muted" }, "Pick a user.");
    var select = window.el("select", { onchange: function (e) { loadUser(e.target.value); } },
      [window.el("option", { value: "" }, "— select —")].concat(
        users.map(function (u) { return window.el("option", { value: u.distinct_id }, u.distinct_id + " (" + u.prompts + " prompts)"); })));
    host.appendChild(window.el("div", { class: "card" }, [window.el("h3", null, "Per-user drill-down"), select]));
    host.appendChild(detail);

    function loadUser(email) {
      if (!email) return;
      detail.innerHTML = ""; detail.appendChild(window.el("div", { class: "muted" }, "Loading " + email + "…"));
      api("user_detail", { user: email }).then(function (rows) {
        detail.innerHTML = "";
        detail.appendChild(window.el("h3", null, email));
        detail.appendChild(window.table(["When", "Event", "Version", "Kind/Message"],
          rows.map(function (r) { return [window.fmtDate(r.ts), r.event, r.v || "—", r.kind || r.msg || ""]; })));
      }).catch(function (e) { detail.innerHTML = ""; detail.appendChild(window.errorCard(e.message)); });
    }
  });
});
```

- [ ] **Step 2: Manual smoke test** — open **Users**, pick a tester. Expected: their event timeline (when / event / version / kind-or-message), newest first. `prompt_text` isn't shown here (Users detail uses `user_detail` which omits it; it's not load-bearing) — confirm no crash when fields are null.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): Users tab — per-tester event drill-down"
```

---

### Task 11: Funnel tab

**Files:**
- Modify: `public/app.js` (append `registerTab("funnel", ...)`)

**Interfaces:**
- Consumes: `api("funnel")`, `api("version_spread")`, `api("engagement")` (for the activation-gap list); render/chart helpers.
- Produces: nothing downstream.

- [ ] **Step 1: Append the Funnel tab** to `public/app.js`.

```javascript
registerTab("funnel", "Funnel", function (host) {
  return Promise.all([api("funnel"), api("version_spread"), api("engagement")]).then(function (res) {
    var f = res[0], vers = res[1], eng = res[2];

    var canvas = window.el("canvas", { class: "chart" });
    host.appendChild(window.el("div", { class: "card" }, [window.el("h3", null, "Launch → prompt → generate → share"), canvas]));
    window.charts.barChart(canvas, [
      { label: "launched", value: f.launched }, { label: "prompted", value: f.prompted },
      { label: "generated", value: f.generated }, { label: "shared", value: f.shared },
    ]);
    host.appendChild(window.el("div", { class: "card" }, [
      window.el("h3", null, "Conversion"),
      window.table(["Step", "Users", "of launched"],
        [["Prompted", f.prompted, window.fmtPct(f.prompted, f.launched)],
         ["Generated", f.generated, window.fmtPct(f.generated, f.launched)],
         ["Shared", f.shared, window.fmtPct(f.shared, f.launched)]]),
    ]));

    var dormant = eng.filter(function (u) { return u.prompts === 0; }).map(function (u) { return [u.distinct_id, window.fmtDate(u.last_seen)]; });
    host.appendChild(window.el("div", { class: "card" }, [
      window.el("h3", null, "Activation gaps — launched, never prompted (" + dormant.length + ")"),
      dormant.length ? window.table(["User", "Last seen"], dormant) : window.el("p", { class: "muted" }, "None 🎉"),
    ]));

    host.appendChild(window.el("div", { class: "card" }, [
      window.el("h3", null, "Version spread"),
      window.table(["Version", "Users", "Events"], vers.map(function (v) { return [v.v, v.users, v.events]; })),
    ]));
  });
});
```

- [ ] **Step 2: Manual smoke test** — open **Funnel**. Expected: funnel bar chart, conversion table with fractions, activation-gap list (dormant users), version-spread table.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): Funnel tab — conversion, activation gaps, version spread"
```

---

### Task 12: Full-suite green + drift/lint pass

**Files:**
- Modify: any (fixups only)

**Interfaces:**
- Consumes: all prior.
- Produces: a clean `pnpm test`.

- [ ] **Step 1: Capture real fixtures** — with `pnpm dev` + a valid key, run each query via `curl` and save the response JSON into `test/fixtures/<name>.json` (replacing hand-authored stubs). Verify `shape.test.ts` still passes against real shapes.

- [ ] **Step 2: Run the full suite**

Run: `pnpm test`
Expected: PASS — auth, queries (incl. drift guard), shape, posthog, index. All green.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(observatory): real fixtures + full green suite"
```

---

### Task 13: Deploy — Worker secrets, Pages, runbook

**Files:**
- Modify: `README.md`
- Create: (Cloudflare-side config, no repo files beyond docs)

**Interfaces:**
- Consumes: a deployed Worker + Pages project.
- Produces: a live URL + a runbook.

- [ ] **Step 1: Set Worker secrets**

```bash
cd ~/studio-observatory
pnpm exec wrangler secret put POSTHOG_PERSONAL_KEY   # paste the phx_… key
pnpm exec wrangler secret put ACCESS_KEYS            # paste comma-separated access key(s)
```

- [ ] **Step 2: Deploy the Worker**

```bash
pnpm run deploy
```
Expected: wrangler prints the Worker URL (e.g. `https://studio-observatory.<subdomain>.workers.dev`). Note it.

- [ ] **Step 3: Verify the live Worker**

```bash
curl -s "https://studio-observatory.<subdomain>.workers.dev/api/q?name=overview_kpis&range=30" -H "Authorization: Bearer <access-key>"
```
Expected: `{ "data": { "active_users": … } }`. Verify a missing/wrong key returns 401.

- [ ] **Step 4: Deploy the dashboard to Pages**

```bash
pnpm exec wrangler pages deploy public --project-name studio-observatory
```
Note the printed Pages URL (e.g. `https://studio-observatory.pages.dev`). Then in the deployed site set the Worker base once: open the site, console → `localStorage.setItem("observatory_api","https://studio-observatory.<subdomain>.workers.dev")`. (Or hardcode `window.OBSERVATORY_API` in `index.html` to the Worker URL and redeploy.)

- [ ] **Step 5: Lock CORS to the Pages origin** — now that the Pages URL is known, set it as the Worker's allowed origin and redeploy so the Worker only accepts cross-origin calls from the dashboard (defence-in-depth behind the access key).

```bash
# add to wrangler.toml [vars]:  ALLOWED_ORIGIN = "https://studio-observatory.pages.dev"
pnpm run deploy
# verify: a request with a foreign Origin header gets no allow-origin for it
curl -si "https://studio-observatory.<subdomain>.workers.dev/api/q?name=overview_kpis&range=30" \
  -H "Authorization: Bearer <access-key>" -H "Origin: https://evil.example" | grep -i access-control-allow-origin
# Expected: the header echoes the Pages origin, NOT https://evil.example
```

- [ ] **Step 6: End-to-end check** — open the Pages URL, enter the access key, confirm all four tabs load live data (charts NOT blank). Confirm the key is NOT in any served file (`view-source` + check `app.js`).

- [ ] **Step 7: Write the README runbook** — fill `README.md` with: architecture diagram, the two secrets + `ALLOWED_ORIGIN` var + how to rotate them, deploy commands, the access-key flow, the residual-risk note (shared key guards real PII — see security note below), and that `andrey.sundiev@devrev.ai` is excluded only when the toggle is on. Commit.

```bash
git add README.md
git commit -m "docs: deploy runbook + architecture"
```

---

## Self-Review

**Spec coverage:**
- Worker proxy + secrets → Tasks 1, 2, 5, 6, 13 ✓
- Access-key auth → Tasks 2, 6, 8, 13 ✓
- Live data, nothing committed → Tasks 5, 6 (no `data/` dir anywhere) ✓
- Date-bucketed trends → `ttft_trend`, `activity_by_day` (Task 3) ✓
- exclude-me default OFF + visible filter note → Tasks 3, 8 ✓
- Small-n honesty (fractions + n) → `fmtPct`, n columns (Tasks 8–11) ✓
- 4 tabs (Overview/Latency/Users/Funnel) → Tasks 8, 9, 10, 11 ✓
- Observatory visual style → Tasks 7, 8 (style skill) ✓
- Drift guard vs event catalog → Tasks 1, 3 ✓
- Error handling (per-section, 401, 502, no-data card) → Tasks 6, 8 ✓
- Testing (queries/shape/auth/posthog/index + **dashboard smoke test**) → Tasks 2–6, 8, 12 ✓
- Security: CORS locked to Pages origin (Tasks 6, 13), prompt_text denylist test + backslash-escape test (Task 3), high-entropy key (Tasks 1, 13) ✓

**Adversarial-review fixes applied (verified against live data + emitter source):**
- C1 canvas blank → `setup()` reads parent width + sets `canvas.style.*`; `.chart` has committed CSS width (Tasks 7, 8).
- C3 funnel denominator → `launched` counts `app_launched` only (Task 3).
- C5 missing dashboard test → jsdom `render.smoke.test.ts` (Task 8).
- C6 racy active-tab → tracked in `state.activeTab`, class owned by `selectTab` (Task 8).
- m4 success rate → `generated / (generated+failed)` (Task 8).
- M1/M3 → CORS origin lock + backslash escaping + denylist test.
- C2 (`toFloat` 502 claim) was **disproven live** (returns null, no error) but `toFloatOrNull`/`toIntOrNull` adopted as free hardening; m2/m3 disproven live (version present; alias OK) — left as-is.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" — every code step has full code. `styles.css` (Task 7 Step 3) defers token *values* to the `observatory-dashboard-style` skill, but the load-bearing chart-sizing CSS is now spelled out (not deferred) — not a placeholder.

**Type consistency:** `buildQuery`/`QueryParams`/`EXCLUDE_ME_ID` (Task 3) used consistently in Task 6. `runHogql` signature (Task 5) matches its call in Task 6. `shape` returns object-for-single-row (`overview_kpis`, `funnel`) consumed as objects in Tasks 8/11; array-returning queries consumed as arrays elsewhere. `api(name, extra)`, `el`, `kpiRow`, `table`, `fmtPct/fmtMs/fmtDate`, `charts.{lineChart,barChart,scatter}` (Task 8) used with matching signatures in Tasks 9–11. Column names in shapes match the `SELECT … AS <alias>` aliases in Task 3.

**Scope:** Single coherent deliverable (one Worker + one static site). 13 sequential-ish tasks, each independently testable/reviewable. No decomposition needed.
