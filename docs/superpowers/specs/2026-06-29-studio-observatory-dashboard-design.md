# Studio Observatory — bespoke PostHog dashboard (design)

**Date:** 2026-06-29
**Status:** approved (revised after adversarial review), ready for implementation plan
**Location:** a **new standalone PRIVATE repo** (e.g. `asundiev-devrev/studio-observatory`).
NOT a subdir of `arcade-prototyper` — that repo is **public**, and this tool
handles beta testers' emails + prompt text, which must never land in a public repo.

## Problem

Studio's beta telemetry lives in PostHog EU (project 197530). PostHog's own UI
is disliked and not tailored to the questions we actually ask about the beta.
We want a bespoke, internal dashboard — beta health, latency, per-user
drill-down, funnel — in the DevRev Observatory visual style.

Reference build (architecture + visual style to copy): `~/ds-observatory-standalone`
— a CLI that collects data into JSON and renders a no-build HTML+CSS+Canvas
dashboard. We mirror its shape, swapping Figma→PostHog.

## How this spec changed (adversarial review findings)

An adversarial review + direct verification corrected three broken premises in
the first draft. Recorded here so we don't regress to them:

1. **PII leak (verified).** `asundiev-devrev/arcade-prototyper` is a **public**
   repo. Committing `distinct_id` (real `@devrev.ai` emails) + `prompt_text`
   there would publish colleagues' identities and prompts to the open internet,
   permanently in git history. → Tool moves to a **private repo**.
2. **GitHub Pages on a private repo is NOT private** on personal/Pro/Team plans
   (needs Enterprise Cloud access control). So "deploy to Pages" cannot be the
   default for data that includes user identity. → **View locally** via a tiny
   static server (the reference's `serve`); Pages is a *future, gated* option,
   only if private-Pages access control is confirmed AND data is de-identified.
3. **Rolling-window snapshots can't make real trends.** Snapshotting "median
   over last 7d" hourly yields a smeared moving average, not a before/after
   step, and a static host can't even list `data/snapshots/*.json` (the
   reference's directory listing only works because `serve` is a live server).
   → Trends come from **date-bucketed queries** (`GROUP BY toDate(timestamp)`)
   in a single HogQL call. No snapshot-history mechanism needed.

## Key decisions

- **Repo:** new **private** repo. Standalone (overrides the earlier subdir plan,
  which assumed a safe-to-commit location — it isn't).
- **Viewing:** **local static server** (`serve`, ~80 lines, from the reference).
  Run `collect` → writes JSON → `serve` → open `localhost`. No build step.
- **Pages:** out of scope for v1. Revisit only if (a) private-Pages access
  control is available on the account AND (b) committed data is de-identified.
- **Data model:** `collect` runs HogQL, writes `data/*.json`; dashboard reads it.
  Live-on-load was rejected (can't safely hold the `phx_` key in a browser);
  snapshot-history was rejected (see finding 3). `collect` is run **on demand**
  (a script you invoke) and/or by a **daily** scheduled job later — not hourly.
- **Trends:** date-bucketed (`GROUP BY toDate`) — point-in-time daily series, so
  a shipped fix shows a true step. One query per trended metric.
- **Key handling:** `phx_…` personal key in a gitignored `.env` for local runs;
  if a scheduled job is added later, the key is a GitHub Actions **repo secret**,
  never served, never in the browser.
- **Filter:** `exclude me` (`andrey.sundiev@devrev.ai`) is a **toggle, default
  OFF** — excluding the heaviest event generator by default makes every chart
  look empty (I'm the main tester). The active filter + excluded-event count are
  shown prominently so "filtered" never reads as "broken."
- **Small-n honesty:** every percentage shows its raw fraction (`67% (4/6)`) and
  every chart shows its `n`, so single-digit-sample noise can't masquerade as a
  trend. With ~6 external users, the per-user **engagement table** is the
  highest-value artifact — readable row by row.
- Use the `observatory-dashboard-style` skill for the visual layer.
- All four tabs are in scope (Overview, Latency, Users, Funnel).

## Architecture

```
src/collect.mjs   reads phx_ key from .env (local) → HogQL queries → public/data/*.json
        │
        ▼
src/serve.mjs     tiny static Node server (from the reference)
        │
        ▼
browser           no-build HTML + CSS + Canvas; fetch ./data/*.json (relative paths)
                  no key, no build, no live PostHog call
```

Two decoupled halves — exactly the reference's `collect` + `serve`. The
dashboard never talks to PostHog; it reads committed/generated JSON. All client
fetches use **relative** paths (`./data/...`) so the same files work locally and
(later) under a Pages subpath.

### PostHog query mechanics (from session memory `posthog-query-recipe`)

- Host `https://eu.posthog.com`, project **197530**.
- HogQL via `POST /api/projects/197530/query/`, `Authorization: Bearer phx_…`.
- Personal key (`phx_…`), NOT the write-only project key (`phc_…`).
- `distinct_id` = user email. Version prop is `properties.version` (not `$app_version`).
- Always break failures down BY VERSION before concluding (legacy vs live).

## Events & properties consumed

(from `arcade-prototyper`'s `studio/src/lib/telemetry/events.ts` — the emitter's
source of truth. NOT co-located here, so a property rename there won't fail this
build — it returns nulls. Mitigation: a test asserting every property referenced
in `queries.mjs` is documented in a checked-in copy of the event catalog.)

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
toggle (default OFF). Every percentage carries its raw fraction; every chart shows `n`.
Landing tab = Overview.

### ① Overview — "how's the beta doing"
- KPI row: Active users, Generations, Success rate % (with fraction), Median duration, Median ttft.
- Activity-by-day chart: distinct users + prompts + generations per day (date-bucketed).
- **Engagement table (highest-value):** per-user prompts / generated / failed / crashes / shares / last-seen — sortable.
- Top-errors strip: `generation_failed` by kind + `frame_runtime_error` by kind, **broken down by version**.

### ② Latency — performance deep-dive
- ttft + duration percentiles (p50/p90/max) by turn_type — **with n shown per cell**; cells with n<5 visibly de-emphasized.
- Same, sliced by version and model.
- num_turns distribution (edit-loop signal).
- duration-vs-output-tokens scatter (generation-bound view).
- timeout / throttle rate, date-bucketed.
- **Date-bucketed trend lines** (e.g. median ttft/day) — true before/after for shipped fixes.

### ③ Users — per-tester drill-down
- Pick a user → funnel, prompts (prompt_text shown **only when present**; not
  load-bearing), failures, versions used, crash messages, last-seen.

### ④ Funnel — adoption / activation
- Launch → prompt → generate → share conversion (fractions shown, not just %).
- Activation gaps (launched, never prompted).
- Version spread (who's on what — fragmentation).

## File layout

```
studio-observatory/                 # new PRIVATE repo
  package.json                      # tsx + dotenv; scripts: collect, serve, test
  .env.example                      # POSTHOG_PERSONAL_KEY / POSTHOG_PROJECT_ID / POSTHOG_HOST
  .gitignore                        # .env, node_modules, public/data/*.json
  README.md                         # setup, key handling, run instructions, the PII/Pages note
  src/
    collect.mjs                     # orchestrates queries → public/data/*.json
    queries.mjs                     # named HogQL builders: buildQuery(name, {range, excludeMe})
    shape.mjs                       # raw PostHog rows → dashboard JSON shape
    serve.mjs                       # tiny static server (from reference)
    event-catalog.json              # checked-in copy of event/prop names for the drift test
  public/
    index.html
    app.js                          # tabs, fetch ./data/*.json (RELATIVE), Canvas charts
    styles.css                      # observatory visual style (Chip fonts, phi spacing)
    data/                           # generated by collect; gitignored (regenerate, don't commit)
      latest.json                   # all tabs' current numbers + date-bucketed series
  test/
    queries.test.mjs                # range substitution, excludeMe clause, drift vs event-catalog
    shape.test.mjs                  # raw response → dashboard JSON, against captured fixtures
```

Note: `public/data/` is **gitignored** — it holds user identity + prompts and is
regenerated by `collect`. Nothing with PII is committed. (If a Pages path is
pursued later, that step must commit a de-identified variant, not this raw data.)

## Error handling

- **Collect:** each named query wrapped independently — a failure writes `null`
  for its section and logs which failed; the run completes with partial data.
- **Missing key:** `collect` exits non-zero with a clear message (never silently
  emit empty data that reads as "no activity").
- **Dashboard:** missing/null section → "no data" card, never a blank screen.
  Empty date-bucket series → chart shows the available points (or a "no data" note).

## Testing

- `queries.mjs` — pure builders. Unit-test: range substitution (7/30/90d), the
  excludeMe clause on/off, date-bucket `GROUP BY` shape. Plus a **drift test**:
  every `properties.X` referenced is present in `event-catalog.json`.
- `shape.mjs` — raw PostHog response → dashboard JSON, against a captured sample
  response per query (one fixture each).
- Dashboard JS — one smoke test that `app.js` renders the KPI row + engagement
  table from a fixture `latest.json`; otherwise manual visual check.
- NOT hitting live PostHog in CI (needs key, flaky). Mock the fetch, test the transform.

## Out of scope (YAGNI)

- **GitHub Pages deployment** (v1 is local-view only; gated on private-Pages
  access control + de-identification — see findings).
- Committing any PII / prompt_text / raw error messages to git.
- Live/real-time streaming (on-demand + optional daily collect is enough).
- Alerting / Slack pings. View-only.
- Writing back to PostHog.

## Resolved (were open questions in draft 1)

- **prompt_text on a public URL** → resolved: private repo, data gitignored,
  never committed. prompt_text shown in the local UI only when present.
- **Trend methodology** → resolved: date-bucketed queries, not rolling-window snapshots.
- **Cadence** → resolved: on-demand now; daily scheduled job later if wanted (not hourly).
