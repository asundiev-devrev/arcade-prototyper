// extension/src/paths.ts
import * as vscode from "vscode";
import path from "node:path";

/** Vendored-CLI directories inside the installed extension. PATH gets prefixed
 *  with these so middleware-spawned claude/aws/figmanage resolve to ours. */
export function resolveBinDirs(context: vscode.ExtensionContext): string[] {
  const root = context.extensionUri.fsPath;
  return [path.join(root, "bin"), path.join(root, "aws-cli")];
}

/** Hidden per-user storage dir for generated frames/projects. Fed to the
 *  server via ARCADE_STUDIO_ROOT (studio/server/paths.ts honors it). */
export function resolveStorageRoot(context: vscode.ExtensionContext): string {
  return context.globalStorageUri.fsPath;
}
