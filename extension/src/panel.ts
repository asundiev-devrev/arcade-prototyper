// extension/src/panel.ts
import * as vscode from "vscode";
import type { ServerHost } from "./serverHost";

/** Pure: the webview document that frames the localhost Studio server. CSP is
 *  scoped to localhost (http for the page, ws for Vite HMR) — no wider host.
 *
 *  'unsafe-inline' script-src is needed for the tiny clipboard-bridge script
 *  below: VS Code intercepts Cmd+V before it reaches the cross-origin iframe,
 *  so paste into the studio inputs does nothing. The extension reads the system
 *  clipboard on Cmd+V (arcade.paste command) and posts it here; this script
 *  relays it into the iframe, which inserts it at the caret. */
export function buildPanelHtml(url: string): string {
  const csp = [
    "default-src 'none'",
    "frame-src http://localhost:*",
    "connect-src http://localhost:* ws://localhost:*",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
  ].join("; ");
  return `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100vh;background:#0d0d0d}</style>
</head>
<body>
  <iframe id="arcade-frame" src="${url}" allow="clipboard-read; clipboard-write"></iframe>
  <script>
    // Clipboard bridge: the extension host posts {type:'arcade:paste', text}
    // when the user hits Cmd+V over this panel; relay it to the localhost
    // iframe, which inserts the text at the caret of its focused input.
    const frame = document.getElementById('arcade-frame');
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m && m.type === 'arcade:paste' && frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'arcade:paste', text: m.text }, '*');
      }
    });
  </script>
</body>
</html>`;
}

let panel: vscode.WebviewPanel | null = null;

/** Post the given clipboard text into the webview so it reaches the iframe.
 *  No-op if the panel isn't open. Called by the arcade.paste command. */
export function relayPaste(text: string): void {
  panel?.webview.postMessage({ type: "arcade:paste", text });
}

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
