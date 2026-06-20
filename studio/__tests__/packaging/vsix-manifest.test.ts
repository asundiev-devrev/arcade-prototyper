// __tests__/packaging/vsix-manifest.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "extension/package.json"), "utf-8"),
);

describe("extension manifest", () => {
  it("targets VS Code engine and activates on the open command", () => {
    expect(manifest.engines?.vscode).toBeTruthy();
    expect(manifest.contributes?.commands?.[0]?.command).toBe("arcade.open");
    expect(manifest.activationEvents).toContain("onCommand:arcade.open");
  });
  it("declares macOS-only via no OS-specific binaries leaking into web", () => {
    // main points at compiled dist, not src
    expect(manifest.main).toBe("./dist/extension.js");
  });
});

describe(".vscodeignore", () => {
  const ignore = fs.readFileSync(path.join(root, "extension/.vscodeignore"), "utf-8");
  it("excludes the extension TypeScript sources but keeps compiled dist", () => {
    expect(ignore).toMatch(/src\/\*\*/);
    expect(ignore).not.toMatch(/^dist/m);
  });
});

describe("stage-vsix script", () => {
  it("exists and is referenced by the pack-vsix script", () => {
    const { existsSync } = require("node:fs");
    expect(existsSync(path.join(root, "studio/packaging/scripts/stage-vsix.mjs"))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    expect(pkg.scripts["studio:pack-vsix"]).toContain("stage-vsix.mjs");
  });

  it("copies the INNER aws-cli dir so the binary lands at aws-cli/aws (on PATH)", () => {
    // resolveBinDirs() prefixes PATH with <ext>/aws-cli, so the aws binary must
    // sit at <ext>/aws-cli/aws — one level. The source layout is nested
    // (aws-cli/aws-cli/aws), so the script must copy the INNER dir. Copying the
    // outer dir double-nests it (aws-cli/aws-cli/aws), off PATH, and spawn("aws")
    // silently falls back to the user's system aws → SSO login fails on testers.
    const script = fs.readFileSync(
      path.join(root, "studio/packaging/scripts/stage-vsix.mjs"),
      "utf-8",
    );
    expect(script).toContain('"studio/packaging/aws-cli/aws-cli"');
  });
});
