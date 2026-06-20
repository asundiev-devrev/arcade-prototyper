import * as vscode from "vscode";
import { ServerHost } from "./serverHost";
import { openOrReveal } from "./panel";

const serverHost = new ServerHost();

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("arcade.open", () => openOrReveal(context, serverHost)),
    vscode.commands.registerCommand("arcade.reload", async () => {
      await serverHost.stop();
      await openOrReveal(context, serverHost);
    }),
  );
}

export async function deactivate(): Promise<void> {
  await serverHost.stop();
}
