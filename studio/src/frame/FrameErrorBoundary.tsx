import React from "react";

type Props = {
  slug: string;
  frame: string;
  children: React.ReactNode;
};

type State = { error: Error | null };

export class FrameErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    window.parent?.postMessage(
      {
        type: "arcade-studio:frame-error",
        slug: this.props.slug,
        frame: this.props.frame,
        message: String(error?.message ?? error),
        stack: String(error?.stack ?? ""),
        componentStack: String(info?.componentStack ?? ""),
      },
      "*",
    );
  }

  render() {
    if (this.state.error) {
      const e = this.state.error;
      // Calm "auto-repairing" panel. The studio dispatches an auto-fix turn
      // server-side as soon as the postMessage above lands, so this iframe
      // is going to get hot-replaced any moment. Front the user with that
      // intent instead of a red stack-trace wall; keep the technical detail
      // available behind a disclosure for the curious. Mirrors the inline
      // shim in `frameMountPlugin.ts`.
      return (
        <div
          style={{
            padding: 24,
            fontFamily:
              "system-ui, -apple-system, sans-serif",
            fontSize: 13,
            lineHeight: 1.5,
            color: "#374151",
            background: "#fafafa",
            minHeight: "100vh",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <style>{`@keyframes arcade-frame-pulse { 0%, 100% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }`}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#a78bfa",
                animation: "arcade-frame-pulse 1.4s ease-in-out infinite",
              }}
            />
            <strong style={{ fontWeight: 600, color: "#111827" }}>
              Auto-repairing this frame
            </strong>
          </div>
          <div style={{ color: "#6b7280", fontSize: 12.5 }}>
            We caught a runtime error and asked the agent to fix it. Watch the
            chat for an update.
          </div>
          <details
            style={{
              marginTop: 12,
              color: "#6b7280",
              fontSize: 12,
              maxWidth: "100%",
            }}
          >
            <summary style={{ cursor: "pointer", color: "#6b7280" }}>
              Show technical details
            </summary>
            <pre
              style={{
                marginTop: 8,
                padding: 10,
                background: "#f3f4f6",
                borderRadius: 6,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11.5,
                lineHeight: 1.5,
                color: "#7f1d1d",
                whiteSpace: "pre-wrap",
                overflow: "auto",
                maxHeight: "60vh",
              }}
            >
              {String(e?.message ?? e)}
              {e?.stack ? `\n\n${String(e.stack)}` : ""}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
