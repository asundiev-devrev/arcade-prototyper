# Arcade Studio share Worker

This is the Cloudflare Worker that Studio clients talk to when a teammate clicks **Share frame**. It holds the real Cloudflare API token as a secret, authenticates each request against a list of per-user share keys, and forwards the deploy to the Cloudflare Pages Direct Upload API.

**You only need this runbook if you are operating the Worker** (deploying it, rotating keys, debugging share failures). Regular Studio users just paste their share key into Settings — see `studio/docs/cloudflare-setup.md` for that flow.

---

## Architecture

```
  Studio (laptop)         share Worker (Cloudflare edge)       Pages API
  ─────────────           ─────────────────────────            ──────────
  user clicks   ──POST /share──►   auth check          ───POST /deployments───►   Cloudflare
  "Share frame"  Authorization:     (ALLOWED_KEYS)       Authorization:           Pages project
                 Bearer <user-key>                      Bearer CF_API_TOKEN
                                    build manifest
                                    forward bundle
                 ◄── { url, id } ──                    ◄── deployment result ──
```

The Cloudflare API token only ever exists inside the Worker. Studio clients never see it.

---

## First-time setup

You need this exactly once per person who will operate the Worker.

### 1. Install wrangler

```
pnpm add -g wrangler@latest
```

Wrangler is Cloudflare's CLI — the equivalent of `vercel` or `gh`. It's a tool for **you** (the Worker operator); beta users never install it.

### 2. Log in

```
wrangler login
```

This opens a browser, you approve the CLI against the **DevRev Product and Design** Cloudflare account, you're done.

### 3. Set the account ID

Edit `studio/worker/wrangler.toml`:

```toml
[vars]
CF_ACCOUNT_ID = "<paste the account ID here>"
```

The account ID is in the Cloudflare dashboard sidebar (same value you grabbed for the original integration).

### 4. Set the secrets

```
# The real Cloudflare API token — scope: Account → Cloudflare Pages → Edit.
# This is the credential that used to be pasted into every teammate's
# settings.json. Now only the Worker holds it.
wrangler secret put CF_API_TOKEN --config studio/worker/wrangler.toml
# paste token, Enter

# Comma-separated list of share keys. Start with one — yours.
wrangler secret put ALLOWED_KEYS --config studio/worker/wrangler.toml
# paste e.g. "a1b2c3...,d4e5f6..." and Enter
```

Generate share keys with:

```
openssl rand -hex 32
```

Each teammate gets their own 64-character hex key. Save them in the **DevRev Product & Design** 1Password vault (one entry per teammate).

### 5. Deploy

```
wrangler deploy --config studio/worker/wrangler.toml
```

Wrangler prints the Worker URL. For a brand-new Worker it'll be something like `arcade-studio-share.<your-workers-subdomain>.workers.dev`.

### 6. Confirm the URL matches the Studio build

Studio has the Worker URL baked in at `studio/server/cloudflare/deploy.ts`:

```ts
export const SHARE_WORKER_URL = "https://arcade-studio-share.devrev-product-design.workers.dev";
```

If your deploy printed a different URL, update that constant and rebuild the `.dmg`.

---

## Managing teammates

The master list of teammate keys lives in **macOS Keychain** on your laptop (one entry per teammate under service `arcade-studio-share-key`). Three helper scripts wrap the boring parts:

```
./bin/add-teammate.sh <name>       # generate + store + upload + deploy
./bin/revoke-teammate.sh <name>    # remove + rebuild + upload + deploy
./bin/list-teammates.sh            # names only (no keys printed)
```

Cloudflare secrets are write-only — the scripts rebuild the full comma-separated `ALLOWED_KEYS` value from your Keychain entries each time and re-put it. Order is alphabetized by name so redeploys produce identical secret values when nothing's changed.

### Adding a teammate

```
cd studio/worker
./bin/add-teammate.sh alice
```

This generates a fresh 64-char hex key, stores it in Keychain under `alice`, updates the Worker's `ALLOWED_KEYS`, redeploys, and prints the raw key **once**.

**Distribute the key via a one-time paste URL:**
1. Copy the printed key.
2. Paste it into https://password.link (or any one-time-secret service). Generates a URL that self-destructs after first open.
3. Slack DM the URL to the teammate.
4. Close the terminal window so the key scrolls out of history.

The teammate opens the URL, copies the key, pastes into Studio → Settings → **Studio share key**. If they fumble the copy, generate a new one-time URL from the same key (Keychain still has it — retrieve with `security find-generic-password -a alice -s arcade-studio-share-key -w`). If that fails, rotate: `./bin/revoke-teammate.sh alice && ./bin/add-teammate.sh alice`.

### Bulk-adding several teammates

When you're onboarding a group, running `add-teammate.sh` N times works but eats N deploys (~20s each). Faster: add every Keychain entry first, then do **one** `wrangler secret put ALLOWED_KEYS` + `wrangler deploy` at the end.

**This must run under bash, not zsh** — the helpers in `_keychain.sh` rely on bash word-splitting semantics. Scripts under `bin/` already use `#!/usr/bin/env bash`, but when you paste the snippet below directly into Terminal you're in your login shell (zsh on modern macOS). Wrap the whole block in `bash -c '...'`:

```bash
bash -c '
  export PATH="$HOME/Library/pnpm:$PATH"
  cd /path/to/arcade-prototyper/studio/worker
  source bin/_keychain.sh
  WRANGLER=$(wrangler_bin)

  OUT=$(mktemp -t arcade-share-keys.XXXXXX)
  chmod 600 "$OUT"

  # List of names to onboard in this batch.
  NAMES=(miha nuska kavinash)

  for name in "${NAMES[@]}"; do
    if [ -n "$(keychain_get "$name")" ]; then
      echo "SKIPPING: \"$name\" already has a Keychain entry"; continue
    fi
    KEY=$(openssl rand -hex 32)
    keychain_put "$name" "$KEY"
    printf "%-16s %s\n" "$name" "$KEY" >> "$OUT"
    echo "  + $name"
  done

  ALLOWED=$(build_allowed_keys_value)
  printf "%s" "$ALLOWED" | "$WRANGLER" secret put ALLOWED_KEYS
  "$WRANGLER" deploy

  echo "Keys saved to $OUT (mode 600)."
'
```

The output file contains one `name<TAB>key` line per teammate. Distribute via one-time paste URLs (same as the single-teammate flow), then:

```bash
shred -u /var/folders/.../arcade-share-keys.XXXXXX.YYYYYY
```

Keychain keeps the master copies — the tmp file is purely for the distribution pass.

**Watch out:** if you source `_keychain.sh` in a zsh shell, `build_allowed_keys_value` silently produces an empty string, which, uploaded, locks out every teammate including you. The helpers error out at source-time to make this obvious, but the `bash -c '...'` wrapper is the right mental model.

### Revoking a teammate

```
cd studio/worker
./bin/revoke-teammate.sh alice
```

Deletes their Keychain entry, rebuilds `ALLOWED_KEYS` without it, redeploys. Revocation takes effect immediately — their next share attempt fails with a 401.

### Moving to a new laptop

The master list lives in Keychain, which **doesn't auto-sync** between Macs unless you enable iCloud Keychain syncing. If you switch laptops:

- If iCloud Keychain is on: the entries come across automatically.
- Otherwise: export on the old laptop with `security dump-keychain -d login.keychain-db -i` (then grep for `arcade-studio-share-key`) or, easiest, just **rotate every teammate** on the new laptop: run `add-teammate.sh` for each name and redistribute new keys.

Rotating on laptop loss is the safer default anyway.

## Access OTP gate (per-project)

Every `/share` call creates (or reuses) a Cloudflare Access Application in front of the Pages project's `*.pages.dev` hostnames. The app is self-hosted, one-time-PIN-gated, and scoped to `@devrev.ai` emails. Viewers hit a sign-in page at `devrev-product.cloudflareaccess.com`, enter their email, receive a 6-digit code, and get a 24h session.

The Worker's `ensureAccessApp()` helper:

1. Lists Access apps for the account (paged, 100 at a time).
2. If an app named `Arcade Studio frames — <project>` already exists, returns early (idempotent no-op for every deploy after the first).
3. Otherwise creates the app covering `<project>.pages.dev` + `*.<project>.pages.dev`, and attaches one policy: `decision: allow, include: [{ email_domain: { domain: "devrev.ai" } }]`.

Failure during `ensureAccessApp` is logged as a warning but does NOT fail the deploy. An unprotected share is better than a broken share — the gate gets added the next time that project is shared.

### Why per-project instead of one `*.pages.dev` app

Cloudflare rejects apps scoped to `*.pages.dev` with `domain does not belong to zone` — that zone is owned by Cloudflare, not us. One Access Application per Pages project is Cloudflare's recommended pattern for internal-team Pages protection and matches the other apps on this account.

### Changing the policy

If you need to allow external emails, the easiest path is manual: open **Zero Trust → Access → Applications**, find `Arcade Studio frames — <project>`, edit the policy, add the external address under `include`. Repeat per project.

For a durable fix — allow a fixed external list across all projects — add a second `include` entry to the policy payload in `src/index.ts` (`ensureAccessApp`), then redeploy the Worker AND rotate every existing app (the Worker's idempotency check skips the policy update). The cleanest way to "rotate" is to delete the old app from the dashboard and re-share once from Studio — the next call recreates it with the new policy.

### Retroactively gating a project

Projects created before the Access code landed are ungated. To fix: open Studio, share any frame in that project. The Worker's `ensureAccessApp` call runs on every deploy, creates the app, and Access immediately applies to all existing URLs of that project (it's an edge-layer gate, not a build-time one).

### Required Cloudflare API token scope

The Worker's `CF_API_TOKEN` secret needs both:

- Account → Cloudflare Pages → Edit
- Account → Access: Apps and Policies → Edit

If `ensureAccessApp` starts failing with 403, the token likely has only the Pages scope. Either edit the existing token in the dashboard (**Profile → API Tokens → Arcade Studio → Edit**) to add the Access scope, or mint a new token with both and `wrangler secret put CF_API_TOKEN`.

## Rotating the Cloudflare API token

Do this quarterly, or immediately if you suspect the token leaked (e.g. a laptop with an untrusted process holding it briefly).

1. Create a new token in the Cloudflare dashboard with the same `Account → Cloudflare Pages → Edit` scope.
2. `wrangler secret put CF_API_TOKEN --config studio/worker/wrangler.toml` → paste the new token.
3. `wrangler deploy --config studio/worker/wrangler.toml`.
4. Confirm a share still works.
5. Revoke the old token in the Cloudflare dashboard.

Teammates' share keys are unaffected by this rotation.

---

## Debugging share failures

`wrangler tail --config studio/worker/wrangler.toml` streams live logs. Common failure modes:

| Symptom | Cause | Fix |
|---|---|---|
| `401 invalid_key` | Teammate's key isn't in `ALLOWED_KEYS` | Check they pasted the right key; re-add it if you removed it by mistake. **If every teammate 401s at once**, you probably uploaded an empty `ALLOWED_KEYS` — re-run `bin/add-teammate.sh <any-existing-name>` which rebuilds + re-uploads the full list, or run the bulk snippet above with an empty `NAMES=()` array |
| `401 missing_key` | Studio sent no `Authorization` header | Usually a stale Studio build; rebuild `.dmg` |
| `502 project_create_failed` | Cloudflare API token is wrong, expired, or missing the Pages scope | Rotate token; confirm scope = `Account → Cloudflare Pages → Edit` |
| Deploy succeeds but viewers see no Access gate | `ensureAccessApp` is failing silently (by design — non-fatal). Check `wrangler tail` for `[access] ensureAccessApp failed: ...`. Most likely: token lacks `Access: Apps and Policies → Edit` scope. | Add the scope to the existing token (**Cloudflare dashboard → Profile → API Tokens → Arcade Studio → Edit**). Next share re-runs the helper and creates the app. |
| `500 worker_misconfigured` | Forgot to set `CF_API_TOKEN` or `CF_ACCOUNT_ID` | Re-run step 3 and step 4 of setup |

## Files

- `wrangler.toml` — Worker config (name, entry point, account ID var)
- `src/index.ts` — the Worker itself (~200 lines, single handler)
