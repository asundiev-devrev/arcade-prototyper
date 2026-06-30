# Studio Observatory — bespoke PostHog dashboard (design)

**Date:** 2026-06-29
**Status:** approved (revised twice — adversarial review, then a Worker-proxy
pivot), ready for implementation plan
**Hosting:** Cloudflare Pages (static site) + a Cloudflare Worker proxy that
holds the PostHog key and gates access. Real shareable URL, live data, no key or
PII ever in the browser or git.

## Problem

Studio's beta telemetry lives in PostHog EU (project 197530). PostHog's own UI
is disliked and not tailored to the questions we actually ask about the beta.
We want a bespoke, internal dashboard — beta health, latency, per-user
drill-down, funnel — in the DevRev Observatory visual style, at a real URL we
can open from any device.

Reference build (visual style + no-build dashboard shape to copy):
`~/ds-observatory-standalone`. Proxy/auth pattern to copy: the existing Studio
share Worker at `studio/worker/` (holds a secret API token, auth-checks each
request against per-user keys, proxies to an upstream API — exactly our shape).

## Design history (so we don't regress)

This design was revised twice. Both pivots are load-bearing:

1. **First draft:** static Pages + hourly snapshots committed to the
   `arcade-prototyper` repo. An adversarial review + verification killed it:
   the repo is **public** (would leak tester emails + prompt_text), Pages on a
   private repo isn't actually private on this account, and rolling-window
   snapshots can't produce real trends.
2. **Second draft:** localhost-only view. Rejected by product owner — wants a
   real URL openable from anywhere, not tied to one machine.
3. **This draft:** a **Cloudflare Worker proxy** resolves the original
   constraints cleanly — the Worker holds the `phx_` key as a secret and
   auth-gates requests, so the browser never sees the key, **data is fetched
   live (never committed)**, and the URL is access-controlled. This also
   restores live-on-load (the originally-preferred data model) and means the
   dashboard repo can be public again (it holds no key and no data).

## Architecture

```
browser  (Cloudflare Pages — static HTML + CSS + Canvas, real URL)
   │  fetch /api/q?name=latency&range=30d&excludeMe=0
   │  Authorization: Bearer <access-key>        ← entered once, stored locally
   ▼
Cloudflare Worker  (the proxy)
   │  • checks <access-key> against ACCESS_KEYS secret  → 401 if absent/wrong
   │  • maps query name → HogQL (server-side; browser can't run arbitrary SQL)
   │  • calls PostHog with POSTHOG_PERSONAL_KEY secret
   ▼
PostHog EU  (project 197530, HogQL)
   ▼  rows → shaped JSON → back to browser
```

Mirrors `studio/worker/` almost exactly: a secret upstream key + an
`ACCESS_KEYS` allow-list, proxying to an upstream API. Two Cloudflare secrets:
`POSTHOG_PERSONAL_KEY` (the `phx_…`) and `ACCESS_KEYS` (the dashboard
password(s)). Neither ever reaches the browser or git.

**Why the browser calls query *names*, not SQL:** keeps HogQL server-side (one
place to maintain + can't be tampered with) and means a leaked access key can
only run our fixed, read-only queries — not arbitrary account-wide reads.

### Data flow & freshness

- **Live-on-load.** Each dashboard open / refresh hits the Worker → PostHog →
  fresh numbers. Nothing is stored or committed. PII (emails, prompt_text) lives
  only transiently in the authed browser session, never on disk or in git.
- **Trends: date-bucketed**, not snapshots. A trended metric is one HogQL query
  with `GROUP BY toDate(timestamp)` returning a real daily series — so a shipped
  fix shows a true before/after step. (The earlier rolling-window-snapshot
  approach is abandoned; it produced smeared moving averages and couldn't be
  listed by a static host.)
- Optional later: the Worker can cache responses (Cache API / KV) for a few
  minutes to spare PostHog quota. Not required for v1.

### Auth

- **Shared access key** (chosen). First visit: enter the key once; stored in
  `localStorage` and sent as `Authorization: Bearer …` on every `/api` call.
- Worker validates against the `ACCESS_KEYS` secret (supports rotating /
  multiple keys, like the share Worker's `ALLOWED_KEYS`). Missing/wrong → 401,
  and the dashboard shows an "enter access key" prompt.
- Not full SSO — adequate for an internal tool. Cloudflare Access (SSO) is a
  later upgrade path if per-person revocation/audit is ever needed.

### PostHog query mechanics (from session memory `posthog-query-recipe`)

- Host `https://eu.posthog.com`, project **197530**.
- HogQL via `POST /api/projects/197530/query/`, `Authorization: Bearer phx_…`.
- Personal key (`phx_…`), NOT the write-only project key (`phc_…`).
- `distinct_id` = user email. Version prop is `properties.version` (not `$app_version`).
- Always break failures down BY VERSION before concluding (legacy vs live).

## Events & properties consumed

(from `arcade-prototyper`'s `studio/src/lib/telemetry/events.ts` — the emitter's
source of truth, in a different repo. A property rename there won't fail this
build — it returns nulls. Mitigation: a checked-in `event-catalog.json` + a test
asserting every `properties.X` referenced by the Worker's queries appears in it.)

- `app_launched` (version, os, os_version, is_first_launch)
- `app_shutdown` (session_duration_ms)
- `prompt_submitted` (prompt_length, prompt_text [opt-in, often absent], project_slug_hash, model, frame_count_before)
- `frame_generated` (duration_ms, **ttft_ms**, **num_turns**, model, tokens_input, tokens_output, turn_type build/edit/none, frame_lines) — ttft_ms + num_turns added 0.41.3
- `generation_failed` (duration_ms, ttft_ms, num_turns, error_kind: bedrock_auth/cli_crash/parser_error/timeout/throttled/other)
- `generation_cancelled` (duration_ms, model)
- `frame_runtime_error` (error_kind, error_message, frame_hash)
- `share_opened` / `share_started` / `share_succeeded` / `share_failed` / `share_url_copied`
- `figma_export_run` (outcome, instance_count, failure_count)
- `settings_opened` (tab)
- `whats_new_shown` (version)

## Tabs & metrics

Global controls (all tabs): date-range toggle **7d / 30d / 90d**; **exclude me**
toggle (default OFF — excluding the heaviest tester by default empties charts).
Every percentage carries its raw fraction; every chart shows its `n`. Active
filter + excluded-event count shown so "filtered" never reads as "broken."
Landing tab = Overview.

### ① Overview — "how's the beta doing"
- KPI row: Active users, Generations, Success rate % (+fraction), Median duration, Median ttft.
- Activity-by-day chart: distinct users + prompts + generations per day (date-bucketed).
- **Engagement table (highest-value):** per-user prompts / generated / failed / crashes / shares / last-seen — sortable.
- Top-errors strip: `generation_failed` by kind + `frame_runtime_error` by kind, **broken down by version**.

### ② Latency — performance deep-dive
- ttft + duration percentiles (p50/p90/max) by turn_type — **n shown per cell**; n<5 visibly de-emphasized.
- Same, sliced by version and model.
- num_turns distribution (edit-loop signal).
- duration-vs-output-tokens scatter (generation-bound view).
- timeout / throttle rate, date-bucketed.
- **Date-bucketed trend lines** (e.g. median ttft/day) — true before/after for shipped fixes.

### ③ Users — per-tester drill-down
- Pick a user → funnel, prompts (prompt_text shown only when present; not load-bearing), failures, versions used, crash messages, last-seen.

### ④ Funnel — adoption / activation
- Launch → prompt → generate → share conversion (fractions shown, not just %).
- Activation gaps (launched, never prompted).
- Version spread (who's on what — fragmentation).

## File layout

```
studio-observatory/                 # standalone repo (visibility optional — holds no key, no data)
  package.json                      # tsx + dotenv + wrangler (dev); scripts: dev, deploy, test
  .gitignore                        # node_modules, .dev.vars
  README.md                         # setup, the two Worker secrets, deploy, auth flow
  worker/
    src/index.ts                    # the proxy: auth check + name→HogQL + PostHog fetch + shaping
    queries.ts                      # named HogQL builders: buildQuery(name, {range, excludeMe})
    shape.ts                        # raw PostHog rows → dashboard JSON shape
    event-catalog.json              # checked-in event/prop names for the drift test
    wrangler.toml                   # routes, name; secrets set via `wrangler secret put`
  public/                           # ← Cloudflare Pages root (static, no data baked in)
    index.html
    app.js                          # tabs, access-key prompt, fetch /api/q (RELATIVE), Canvas charts
    styles.css                      # observatory visual style (Chip fonts, phi spacing)
  test/
    queries.test.ts                 # range substitution, excludeMe clause, GROUP BY shape, drift vs catalog
    shape.test.ts                   # raw response → dashboard JSON, against captured fixtures
```

Secrets live only in Cloudflare (`wrangler secret put POSTHOG_PERSONAL_KEY` /
`ACCESS_KEYS`); for local Worker dev they go in `.dev.vars` (gitignored). No
`data/` directory — data is live, never written to disk or committed.

## Error handling

- **Worker per-query:** each named query wrapped — a failure returns
  `{ section: null, error }` for that section, not a 500 for the whole load.
  Partial data beats a dead dashboard. Logs which query failed.
- **Auth:** missing/invalid access key → 401; dashboard shows the access-key prompt.
- **PostHog upstream error / rate-limit:** surfaced to the browser as a section
  error card; the rest of the tab still renders.
- **Dashboard:** missing/null section → "no data" card, never a blank screen.

## Testing

- `queries.ts` — pure builders. Unit-test: range substitution (7/30/90d),
  excludeMe clause on/off, date-bucket `GROUP BY` shape, and a **drift test**:
  every `properties.X` referenced is present in `event-catalog.json`.
- `shape.ts` — raw PostHog response → dashboard JSON, against a captured sample
  per query (one fixture each).
- Worker auth — unit-test: no key → 401, wrong key → 401, valid key → passes to query layer (PostHog fetch mocked).
- Dashboard JS — one smoke test that `app.js` renders the KPI row + engagement
  table from a fixture response; otherwise manual visual check.
- NOT hitting live PostHog in CI (needs key, flaky). Mock the fetch, test the transform.

## Out of scope (YAGNI)

- Cloudflare Access / SSO (shared access key is enough for v1; SSO is the upgrade path).
- Response caching in the Worker (add later if PostHog quota bites).
- Committing any data or key to git.
- Alerting / Slack pings. View-only.
- Writing back to PostHog.

## Resolved (were open questions / rejected approaches)

- **PII exposure** → live data via authed Worker; nothing committed, URL gated.
- **Key safety** → `phx_` is a Worker secret; browser sends only an access key.
- **Real URL vs localhost** → Cloudflare Pages, openable anywhere.
- **Trend methodology** → date-bucketed queries, not rolling-window snapshots.
- **Repo visibility** → no longer forced private (repo holds no secret, no data).
