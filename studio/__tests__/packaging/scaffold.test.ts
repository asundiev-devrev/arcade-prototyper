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

  it("targets ZIP for arm64 (auto-update payload)", () => {
    const target = config.mac?.target;
    expect(target).toBeDefined();
    const zipEntry = Array.isArray(target)
      ? target.find((t: { target: string }) => t.target === "zip")
      : null;
    expect(zipEntry).toBeDefined();
    expect(zipEntry?.arch).toBe("arm64");
  });

  it("uses hardened runtime + entitlements", () => {
    expect(config.mac?.hardenedRuntime).toBe(true);
    expect(config.mac?.entitlements).toBe("electron/entitlements.mac.plist");
  });

  it("declares the Developer ID identity", () => {
    // electron-builder requires the name WITHOUT the "Developer ID
    // Application: " prefix — Apple's codesign adds it back automatically.
    expect(config.mac?.identity).toContain("DevRev, Inc.");
    expect(config.mac?.identity).toContain("NJDA6Y3XRS");
    expect(config.mac?.identity).not.toContain("Developer ID Application:");
  });

  it("disables electron-builder's auto-notarize", () => {
    // electron-builder 25 only accepts APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD
    // env vars for notarize and ignores keychain profiles. We notarize
    // manually post-pack via `xcrun notarytool submit ... --keychain-profile`.
    // See studio/CLAUDE.md "Releasing a new version" for the full flow.
    expect(config.mac?.notarize).toBe(false);
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

  it("re-includes template thumbnails after the blanket image exclusion", () => {
    const yml = fs.readFileSync(CONFIG_PATH, "utf-8");
    const exclusionIdx = yml.indexOf('"!**/*.{png,jpg,jpeg,gif}"');
    const reincludeIdx = yml.indexOf("studio/prototype-kit/template-thumbs/**/*.png");
    expect(exclusionIdx).toBeGreaterThan(-1);
    expect(reincludeIdx).toBeGreaterThan(-1);
    expect(reincludeIdx).toBeGreaterThan(exclusionIdx); // last-match-wins
  });
});
