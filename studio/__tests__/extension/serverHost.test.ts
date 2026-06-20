// __tests__/extension/serverHost.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { buildServerEnv } from "../../../extension/src/serverHost";

describe("buildServerEnv", () => {
  const env = buildServerEnv({
    binDirs: ["/ext/bin", "/ext/aws-cli"],
    storageRoot: "/store",
    basePath: "/usr/bin:/bin",
    nodeBin: "/path/to/code-electron",
    appVersion: "0.39.0",
  });

  it("prefixes PATH with the vendored bin dirs", () => {
    expect(env.PATH.startsWith("/ext/bin:/ext/aws-cli:")).toBe(true);
    expect(env.PATH.endsWith("/usr/bin:/bin")).toBe(true);
  });
  it("points the frame storage root at the extension storage dir", () => {
    expect(env.ARCADE_STUDIO_ROOT).toBe("/store");
  });
  it("marks the run as packaged and pins the claude binary", () => {
    expect(env.ARCADE_IS_PACKAGED).toBe("1");
    expect(env.ARCADE_STUDIO_CLAUDE_BIN).toBe(path.join("/ext/bin", "claude"));
  });
  it("exposes the host node binary for the figmanage wrapper", () => {
    // The staged bin/figmanage wrapper exec's this via ELECTRON_RUN_AS_NODE.
    // In a VSIX there is no Electron .app, so the wrapper cannot use the
    // old Contents/MacOS path — it uses the host editor's Electron instead.
    expect(env.ARCADE_NODE_BIN).toBe("/path/to/code-electron");
  });
  it("passes the app version through for server telemetry", () => {
    // The extension host never inherits ARCADE_APP_VERSION, so it must be
    // sourced from the manifest and passed explicitly — else telemetry
    // reports "0.0.0".
    expect(env.ARCADE_APP_VERSION).toBe("0.39.0");
  });
});
