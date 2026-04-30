# AWS SSO setup for Arcade Studio

Arcade Studio uses AWS Bedrock to run Claude. You need one AWS SSO profile
configured on your Mac before the app can generate prototypes.

The DMG ships with the AWS CLI bundled, writes the DevRev SSO profile
into `~/.aws/config` on first launch, and spawns all child processes
with `AWS_PROFILE=dev`. Onboarding is one click inside the app.

## First-time setup (~30 seconds)

1. Open Arcade Studio, type a prompt.
2. When the "Your AWS session looks expired" banner appears, click
   **Sign in to AWS**. A browser tab opens — sign in with your DevRev
   account and close the tab when it says "Request approved".
3. Retry the prompt.

You'll see that banner once every ~8 hours (AWS SSO session TTL).
Every time, one click is all it takes.

## If you prefer the Terminal path

If you'd rather not use the in-app button (e.g. you already have a
Terminal session open for other reasons):

```bash
aws sso login --profile dev
```

Both paths write to the same token cache, so it doesn't matter which
you use.

## Refreshing your session

SSO tokens last about 8 hours. When they expire, studio will show:

> API Error: Token is expired. To refresh this SSO session run
> `aws sso login` with the corresponding profile.

Fix it in one command:

```bash
aws sso login --profile dev
```

Then retry the prompt in studio. No restart required.

## Troubleshooting

**`An error occurred (Configuration): Missing the following required SSO
configuration values: sso_start_url, sso_region`**

The app didn't get to write `~/.aws/config` — usually because it hasn't
been launched yet after installing the DMG. Launch Arcade Studio once
(it writes the config on boot), then retry `aws sso login --profile dev`.

If it still fails, add the profile block manually:

```ini
[profile dev]
sso_start_url = https://d-9067645937.awsapps.com/start#
sso_region = us-east-1
sso_account_id = 020040093233
sso_role_name = BedrockLongLivedTokenAccess
region = us-east-1
```

**Studio keeps showing "Thinking…" and never responds**

You're likely on an old DMG. Download the latest
`Arcade Studio.dmg` from the repo and reinstall. The fixed version
surfaces the underlying AWS error within a second instead of hanging.

**`aws: command not found`**

AWS CLI isn't installed. Run `brew install awscli` (step 1 above).
