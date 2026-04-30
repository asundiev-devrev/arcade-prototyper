# AWS SSO setup for Arcade Studio

Arcade Studio uses AWS Bedrock to run Claude. You need one AWS SSO profile
configured on your Mac before the app can generate prototypes. This is a
one-time setup; after it, you'll just re-authenticate every few hours.

## One-time setup (~2 minutes)

1. Install the AWS CLI if you don't have it:

   ```bash
   brew install awscli
   ```

2. Open `~/.aws/config` (create it if it doesn't exist) and paste:

   ```ini
   [profile dev]
   sso_start_url = https://d-9067645937.awsapps.com/start#
   sso_region = us-east-1
   sso_account_id = 020040093233
   sso_role_name = BedrockLongLivedTokenAccess
   region = us-east-1
   ```

3. Sign in once:

   ```bash
   aws sso login --profile dev
   ```

   A browser tab opens. Sign in with your DevRev account. The tab closes
   itself when done.

4. Tell your shell to use this profile by default. Add this line to the
   bottom of `~/.zshrc` (or `~/.bash_profile` if you use bash):

   ```bash
   export AWS_PROFILE=dev
   ```

   Then reload:

   ```bash
   source ~/.zshrc
   ```

5. Quit and re-open Arcade Studio. The first chat turn should now work.

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

You skipped step 2 above, or the `[profile dev]` block is in the wrong
file. Verify:

```bash
cat ~/.aws/config
```

It should show the block from step 2.

**Studio keeps showing "Thinking…" and never responds**

You're likely on an old DMG. Download the latest
`Arcade Studio.dmg` from the repo and reinstall. The fixed version
surfaces the underlying AWS error within a second instead of hanging.

**`aws: command not found`**

AWS CLI isn't installed. Run `brew install awscli` (step 1 above).
