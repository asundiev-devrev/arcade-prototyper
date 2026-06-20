// extension/src/serverHost.ts
import type * as vscode from "vscode";
import path from "node:path";
import { pickFreePort } from "../../electron/shared/freePort";
import { startVite, stopVite } from "../../electron/viteRunner";
import { bootstrapAwsProfile } from "../../electron/shared/awsBootstrap";
import { resolveBinDirs, resolveStorageRoot } from "./paths";

/** Pure: the env overrides the Vite child needs to behave like the packaged app. */
export function buildServerEnv(opts: {
  binDirs: string[];
  storageRoot: string;
  basePath: string;
  nodeBin: string;
}): Record<string, string> {
  return {
    PATH: `${opts.binDirs.join(":")}:${opts.basePath}`,
    ARCADE_STUDIO_ROOT: opts.storageRoot,
    ARCADE_IS_PACKAGED: "1",
    ARCADE_APP_VERSION: process.env.ARCADE_APP_VERSION ?? "",
    ARCADE_STUDIO_CLAUDE_BIN: path.join(opts.binDirs[0], "claude"),
    // The staged bin/figmanage wrapper runs figmanage's JS entry via this
    // node binary (the host editor's Electron, which honors
    // ELECTRON_RUN_AS_NODE). A VSIX has no Arcade .app, so the wrapper
    // cannot exec Contents/MacOS/Arcade Studio like the desktop build does.
    ARCADE_NODE_BIN: opts.nodeBin,
  };
}

export class ServerHost {
  private url: string | null = null;

  isRunning(): boolean {
    return this.url !== null;
  }

  /** Boot the Studio Vite server (singleton). Returns the localhost URL. */
  async start(context: vscode.ExtensionContext): Promise<string> {
    if (this.url) return this.url;

    const binDirs = resolveBinDirs(context);
    const storageRoot = resolveStorageRoot(context);

    // Task 1 spike verdict: GO without quarantine-stripping — the vendored
    // claude/aws binaries are Developer-ID signed, so Gatekeeper runs them
    // even with the quarantine xattr. No stripQuarantine call needed.

    bootstrapAwsProfile();

    // Apply env to THIS process so the spawned Vite child inherits it
    // (startVite spreads process.env). Mirrors electron/main.ts patchPath().
    // process.execPath is the host editor's Electron binary, reused as node
    // (ELECTRON_RUN_AS_NODE) for the staged figmanage wrapper.
    const overrides = buildServerEnv({
      binDirs,
      storageRoot,
      basePath: process.env.PATH ?? "",
      nodeBin: process.execPath,
    });
    Object.assign(process.env, overrides);

    const appRoot = context.extensionUri.fsPath;
    const port = await pickFreePort();
    this.url = await startVite(appRoot, { port });
    return this.url;
  }

  async stop(): Promise<void> {
    await stopVite();
    this.url = null;
  }
}
