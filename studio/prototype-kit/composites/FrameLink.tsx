import type { ReactNode, KeyboardEvent } from "react";

export interface FrameLinkProps {
  /** Target frame slug (e.g. "02-skill-modal"). Must exist in the project. */
  target: string;
  children: ReactNode;
}

/**
 * Wraps an element and makes clicking (or pressing Enter/Space on) the wrapped
 * content navigate to another frame in the same prototype. Uses postMessage to
 * signal the parent viewport; the parent handles scrolling and highlighting.
 *
 * Invisible by design — adds only a pointer cursor. The wrapped element keeps
 * its own appearance.
 */
export function FrameLink({ target, children }: FrameLinkProps) {
  function navigate() {
    try {
      const source = currentFrameSlug();
      window.parent?.postMessage(
        { type: "arcade-studio:navigate", target, ...(source ? { source } : {}) },
        "*",
      );
    } catch {
      // Cross-origin guard. Studio's iframes are always same-origin, so in
      // practice this never throws; swallow defensively for safety.
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={navigate}
      onKeyDown={onKeyDown}
      style={{ cursor: "pointer", display: "contents" }}
    >
      {children}
    </div>
  );
}

/**
 * Derive the current frame's slug from the iframe URL. Studio mounts each
 * frame at `/api/frames/<projectSlug>/<frameSlug>`, so the last non-empty
 * path segment is the frame slug. Returns undefined if the path doesn't
 * match (e.g. the component runs outside a mounted frame — during tests,
 * inside Storybook, etc.).
 */
function currentFrameSlug(): string | undefined {
  const match = window.location.pathname.match(
    /^\/api\/frames\/[^/]+\/([^/?#]+)\/?$/,
  );
  return match?.[1];
}
