import * as vscode from "vscode";
import { ServerHost } from "./serverHost";
import { openOrReveal, relayPaste } from "./panel";

const serverHost = new ServerHost();

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("arcade.open", () => openOrReveal(context, serverHost)),
    vscode.commands.registerCommand("arcade.reload", async () => {
      await serverHost.stop();
      await openOrReveal(context, serverHost);
    }),
    // Cmd+V over the panel: VS Code swallows the keystroke before the
    // cross-origin localhost iframe sees it, so native paste into the studio
    // inputs is dead. Read the system clipboard here and relay it into the
    // iframe (bound via the keybinding in package.json, scoped to our panel).
    vscode.commands.registerCommand("arcade.paste", async () => {
      const text = await vscode.env.clipboard.readText();
      if (text) relayPaste(text);
    }),
  );
}

export async function deactivate(): Promise<void> {
  await serverHost.stop();
}
