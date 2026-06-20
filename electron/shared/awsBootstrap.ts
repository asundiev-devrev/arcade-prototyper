import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * First-run bootstrap of ~/.aws/config with the DevRev SSO [profile dev]
 * block. Idempotent (literal ^[profile dev] line match — never clobbers a
 * customized profile). Always defaults AWS_PROFILE=dev so spawned claude/aws
 * subprocesses inherit it. Shared by both host adapters (electron + extension).
 *
 * The SSO values match the DevRev Bedrock portal; if they change, this block
 * AND studio/docs/aws-setup.md must be updated in lockstep.
 *
 * @param homeDir override for the home directory (tests only).
 */
export function bootstrapAwsProfile(homeDir: string = os.homedir()): void {
  const awsDir = path.join(homeDir, ".aws");
  const awsConfig = path.join(awsDir, "config");

  let existing = "";
  try {
    existing = fs.readFileSync(awsConfig, "utf-8");
  } catch {
    // ENOENT — treat as empty
  }

  if (!/^\[profile dev\]/m.test(existing)) {
    const block = [
      "",
      "[profile dev]",
      "sso_start_url = https://d-9067645937.awsapps.com/start#",
      "sso_region = us-east-1",
      "sso_account_id = 020040093233",
      "sso_role_name = BedrockLongLivedTokenAccess",
      "region = us-east-1",
      "",
    ].join("\n");
    fs.mkdirSync(awsDir, { recursive: true });
    fs.appendFileSync(awsConfig, block);
    console.log(`[awsBootstrap] Installed [profile dev] into ${awsConfig}`);
  }

  process.env.AWS_PROFILE = process.env.AWS_PROFILE || "dev";
}
