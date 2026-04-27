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
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
            lineHeight: 1.5,
            color: "#b91c1c",
            background: "#fef2f2",
            minHeight: "100vh",
            boxSizing: "border-box",
            whiteSpace: "pre-wrap",
            overflow: "auto",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Frame failed to render</div>
          <div style={{ marginBottom: 16 }}>{String(e?.message ?? e)}</div>
          {e?.stack ? (
            <div style={{ color: "#7f1d1d", fontSize: 12 }}>{String(e.stack)}</div>
          ) : null}
        </div>
      );
    }
    return this.props.children;
  }
}
