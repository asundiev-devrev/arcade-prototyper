// extension/src/panel.ts
import * as vscode from "vscode";
import type { ServerHost } from "./serverHost";

/** Pure: the webview document that frames the localhost Studio server. CSP is
 *  scoped to localhost (http for the page, ws for Vite HMR) — no wider host. */
export function buildPanelHtml(url: string): string {
  const csp = [
    "default-src 'none'",
    "frame-src http://localhost:*",
    "connect-src http://localhost:* ws://localhost:*",
    "style-src 'unsafe-inline'",
  ].join("; ");
  return `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100vh;background:#0d0d0d}</style>
</head>
<body>
  <iframe src="${url}" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`;
}

let panel: vscode.WebviewPanel | null = null;

export async function openOrReveal(
  context: vscode.ExtensionContext,
  serverHost: ServerHost,
): Promise<void> {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Active);
    return;
  }
  panel = vscode.window.createWebviewPanel(
    "arcadePrototyper",
    "Arcade",
    vscode.ViewColumn.Active, // full editor tab
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);

  try {
    const url = await serverHost.start(context);
    panel.webview.html = buildPanelHtml(url);
  } catch (err) {
    panel.webview.html =
      `<body style="font-family:sans-serif;padding:24px;color:#eee;background:#0d0d0d">` +
      `<h3>Arcade failed to start</h3><pre>${String((err as Error)?.message ?? err)}</pre>` +
      `<p>Run "Arcade: Reload" from the command palette.</p></body>`;
  }
}
