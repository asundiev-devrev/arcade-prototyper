# AWS SSO setup for Arcade Studio

Arcade Studio uses AWS Bedrock to run Claude. You need one AWS SSO profile
configured on your Mac before the app can generate prototypes.

The app writes the DevRev SSO profile into `~/.aws/config` for you on
first launch, and spawns all AWS calls with `AWS_PROFILE=dev`. All you
have to do manually is install the AWS CLI and sign in once.

## One-time setup (~1 minute)

1. Install the AWS CLI if you don't have it:

   ```bash
   brew install awscli
   ```

2. Sign in:

   ```bash
   aws sso login --profile dev
   ```

   A browser tab opens. Sign in with your DevRev account. The tab closes
   itself when done.

3. Open (or reopen) Arcade Studio. The first chat turn should work.

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
