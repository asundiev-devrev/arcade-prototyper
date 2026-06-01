# Arcade in Computer — what's decided, what's open

## How it works

Computer talks to the kit over **plain HTTP**, nothing more. The agent:

1. Fetches `GET /manifest` — the catalog of every component.
2. Fetches `GET /manifest/<Name>` for the few it'll use.
3. Writes a `frame.tsx`, POSTs it to `/pack`, gets back finished HTML.

The "sidecar" is the small local service that answers those calls. It's the
thing that holds the component kit and does the compiling.

## The one thing this settles

Computer does **not** import the kit as code. It only calls the URLs above.

So Computer needs **no npm package, no registry access, no shared library**.
The kit lives entirely inside the sidecar. That removes the whole
"publish/version/vendor the kit into devrev-web" question — it was never on
the path.

## The one open decision

Where does the sidecar run? Pick one:

| | What it means | Trade-off |
|---|---|---|
| **Bundle into the app** | Ships inside the Computer Mac app, starts on launch | Self-contained, works offline. Bigger app; needs start/health/restart handling. |
| **Host as a service** | Runs on a DevRev server, every Computer hits one URL | One place to update the kit. Needs network, auth, uptime. |
| **Spawn on demand** | App fetches + runs it the first time a prototype is asked for | App stays small. Cold-start delay; need to trust the download. |

This is the call for whoever owns the Computer desktop runtime. Everything
else (the manifest split, the prompt wiring, the pack pipeline) is built and
tested.
