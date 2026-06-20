// __tests__/electron/awsBootstrap.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootstrapAwsProfile } from "../../../electron/shared/awsBootstrap";

describe("bootstrapAwsProfile", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "aws-bootstrap-"));
    delete process.env.AWS_PROFILE;
  });

  it("writes [profile dev] when ~/.aws/config is missing", () => {
    bootstrapAwsProfile(home);
    const cfg = fs.readFileSync(path.join(home, ".aws", "config"), "utf-8");
    expect(cfg).toMatch(/^\[profile dev\]/m);
    expect(cfg).toContain("sso_role_name = BedrockLongLivedTokenAccess");
    expect(process.env.AWS_PROFILE).toBe("dev");
  });

  it("does not duplicate an existing [profile dev] block", () => {
    const awsDir = path.join(home, ".aws");
    fs.mkdirSync(awsDir, { recursive: true });
    fs.writeFileSync(path.join(awsDir, "config"), "[profile dev]\nregion = us-west-2\n");
    bootstrapAwsProfile(home);
    const cfg = fs.readFileSync(path.join(awsDir, "config"), "utf-8");
    expect(cfg.match(/\[profile dev\]/g)).toHaveLength(1);
    expect(cfg).toContain("us-west-2"); // user's value untouched
  });
});
