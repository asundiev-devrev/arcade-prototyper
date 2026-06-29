# Generation latency — baseline (2026-06-29)

Snapshot of generation timing **before** the latency fixes, so we can measure
the impact afterward. Re-run the same queries after shipping and compare.

## What the numbers mean

- **ttft** — time to first token: from prompt submit to the first character of
  the model's output. The "thinking" wait before anything appears.
- **duration** — total wall time for the whole turn (all tool turns + output).
- **p50** — median (typical case). **p90** — the slow 1-in-10. **max** — worst seen.
- **out** — output tokens streamed. **turns** — `numTurns` (1 = clean one-shot;
  higher = Read→Edit-fail→Write→re-verify loops).
- **turn_type** — `build` (new frame), `edit` (change existing), `none` (no frame written).

Latency is **generation-bound**: wall time tracks output tokens almost linearly
(~55 tok/s, flat across models). The levers are (1) output volume and (2) how
the wait is *perceived* (ttft is ~5x faster than total, but the UI shows none of it).

## Local baseline — andrey's machine (`generation-metrics.jsonl`, 70 ok runs)

This is the only source that currently carries **ttft** and **numTurns**.

| turn_type | n  | ttft p50 | ttft p90 | dur p50 | dur p90 | dur max | out p50 | turns p50 |
|-----------|----|----------|----------|---------|---------|---------|---------|-----------|
| build     | 22 | 11.4s    | 17.6s    | 67.5s   | 161.4s  | 192.8s  | 3790    | 6         |
| edit      | 35 | 5.3s     | 10.7s    | 27.0s   | 57.3s   | 81.9s   | 1122    | 4         |
| none      | 13 | 6.9s     | 9.7s     | 11.3s   | 32.8s   | 38.5s   | 307     | 1         |
| **ALL**   | 70 | 6.9s     | 16.7s    | 29.8s   | 96.1s   | 192.8s  | 1140    | 4         |

**Perception gap:** edit ttft p50 = 5.3s, but total p50 = 27.0s. The user waits
~27s while the UI shows a static animation — first output was ready at 5s.

## Tester baseline — PostHog, last 30d, excluding andrey (27 frame_generated)

PostHog does **not** carry ttft or numTurns yet (fix in this batch). Duration + output only.

| turn_type | n  | dur p50 | dur p90 | dur max | out p50 |
|-----------|----|---------|---------|---------|---------|
| edit      | 21 | 41.3s   | 78.2s   | 122.6s  | 2381    |
| build     | 4  | 67.2s   | 116.9s  | 135.3s  | 3318    |
| none      | 2  | 9.4s    | 10.8s   | 11.1s   | 290     |
| **ALL**   | 27 | 41.3s   | 78.8s (avg 48.6s) | 135.3s | — |

Testers are **slower than local** (edit p50 41s vs 27s) and stream **more tokens
per edit** (2381 vs 1122) — small-intent prompts producing full-file rewrites.
Timeouts observed on current 0.39.0.

## How to reproduce

**Local** (has ttft + turns):
```
F="$HOME/Library/Application Support/arcade-studio/generation-metrics.jsonl"
# p50/p90 of ttftMs, durationMs, outputTokens, numTurns grouped by turnType
```
(see session helper `/tmp/phq.py` for the PostHog path)

**PostHog** (tester-side, HogQL — see memory `posthog-query-recipe`):
```sql
SELECT properties.turn_type tt, count() n,
  round(quantile(0.5)(toFloat(properties.duration_ms))/1000,1) dur_p50,
  round(quantile(0.9)(toFloat(properties.duration_ms))/1000,1) dur_p90,
  round(quantile(0.5)(toFloat(properties.tokens_output))) out_p50
FROM events
WHERE event='frame_generated' AND timestamp > now() - INTERVAL 30 DAY
  AND distinct_id != 'andrey.sundiev@devrev.ai'
GROUP BY tt ORDER BY n DESC
```
After ttft_ms / num_turns land in telemetry, add them to the SELECT and refill
the tester table above.

## Targets after fixes

- **Perceived wait**: user sees output within ~ttft (5-11s), not after full duration.
- **Edit output tokens**: down materially (fewer full-file Write fallbacks).
- **numTurns p50 for edits**: down from 4 toward 1-2.
- **Tester duration p50/p90**: down; fewer timeouts on current version.
