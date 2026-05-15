import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CONFIG_PATH = path.join(REPO_ROOT, "electron-builder.yml");

describe("electron-builder configuration", () => {
  const config = yaml.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

  it("declares the correct app ID", () => {
    expect(config.appId).toBe("ai.devrev.internal.ArcadeStudio");
  });

  it("declares the correct product name", () => {
    expect(config.productName).toBe("Arcade Studio");
  });

  it("targets DMG for arm64", () => {
    const target = config.mac?.target;
    expect(target).toBeDefined();
    const dmgEntry = Array.isArray(target)
      ? target.find((t: { target: string }) => t.target === "dmg")
      : null;
    expect(dmgEntry).toBeDefined();
    expect(dmgEntry?.arch).toBe("arm64");
  });

  it("uses hardened runtime + entitlements", () => {
    expect(config.mac?.hardenedRuntime).toBe(true);
    expect(config.mac?.entitlements).toBe("electron/entitlements.mac.plist");
  });

  it("declares the Developer ID identity", () => {
    expect(config.mac?.identity).toContain("Developer ID Application: DevRev, Inc.");
    expect(config.mac?.identity).toContain("NJDA6Y3XRS");
  });

  it("notarizes via the correct team ID", () => {
    expect(config.mac?.notarize?.teamId).toBe("NJDA6Y3XRS");
  });

  it("registers the arcade-studio:// URL scheme", () => {
    const urlTypes = config.mac?.extendInfo?.CFBundleURLTypes;
    expect(urlTypes).toBeDefined();
    expect(urlTypes[0].CFBundleURLSchemes).toContain("arcade-studio");
  });

  it("publishes to the public mirror", () => {
    expect(config.publish?.provider).toBe("github");
    expect(config.publish?.owner).toBe("asundiev-devrev");
    expect(config.publish?.repo).toBe("arcade-studio-releases");
  });
});
