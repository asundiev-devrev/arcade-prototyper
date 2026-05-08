/**
 * FrameLink — wraps an element and makes clicking (or keyboard-activating)
 * it navigate to another frame in the same multi-frame prototype.
 *
 * The wrapper renders `display: contents`, so the wrapped element's own
 * layout is preserved. `role="button"` + `tabIndex={0}` give keyboard users
 * the same affordance as mouse users; Enter and Space trigger navigation.
 * Styled only with `cursor: pointer` — no visible "this is a link"
 * affordance. The "click → navigate" relationship is invisible by design.
 *
 * When clicked, the wrapper posts
 * `{ type: "arcade-studio:navigate", target: "<frame-slug>", source: "<current-frame-slug>" }`
 * to the parent window. The studio viewport handles the scroll + highlight.
 *
 * Why this composite exists: multi-frame prototypes (0.13+) render frames
 * side-by-side but with no inter-frame interactivity. `FrameLink` lets the
 * agent wire a prompt's explicit transitions ("click X, see Y") without
 * reinventing navigation in every frame.
 *
 * @counterexample Do NOT wrap an element unless the prompt explicitly names
 *   it as a transition trigger. Navigation is a specific choice the designer
 *   made, not a general property of multi-frame prototypes. If the prompt is
 *   silent about what triggers transitions, list "no navigation wired — prompt
 *   didn't specify triggers" in your Deviations section and ship without.
 * @counterexample Do NOT wrap entire regions
 *   (`<FrameLink target="02"><div className="container">…</div></FrameLink>`).
 *   Wrap the clickable element only — the specific card, button, or control
 *   the prompt names. Wrapping containers makes every pixel inside them
 *   trigger navigation.
 * @counterexample Do NOT use `<FrameLink>` instead of a regular `<Button>`
 *   for in-frame interactions (opening a dropdown, toggling a switch, showing
 *   a tooltip). Those are intra-frame; they don't need navigation.
 */
import type { ReactNode, KeyboardEvent } from "react";

export interface FrameLinkProps {
  /** Target frame slug (e.g. "02-skill-modal"). Must exist in the project. */
  target: string;
  children: ReactNode;
}

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
