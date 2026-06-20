import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand("arcade.open", () => {
    vscode.window.showInformationMessage("Arcade Prototyper — activating…");
  });
  context.subscriptions.push(cmd);
}

export function deactivate(): void {
  // server teardown wired in Task 8
}
