import { runClaudeTurn } from "../claudeCode";
import { projectDir } from "../paths";
import { resolveClaudeBin } from "../claudeBin";

/**
 * Build the scoped prompt for AI-expanding an un-authored composite. The
 * rewrite: replace the top-level `<tag>` in the frame's index.tsx with flat
 * arcade primitives + raw markup that render the same visual result, inlining
 * the page chrome the composite provides. Touch nothing else, use only arcade
 * design-token classes, no new imports beyond the four arcade roots.
 */
export function buildAiExpandPrompt(frameSlug: string, tag: string): string {
  return [
    `Rewrite the top-level <${tag}> in frames/${frameSlug}/index.tsx into the equivalent FLAT layout:`,
    `replace it with arcade primitives + raw host markup (div/span/h1/p/etc.) that render the SAME visual result,`,
    `inlining the page chrome the composite provides so the page becomes directly editable.`,
    `Keep every prop/child the composite was given (move them into the equivalent flat slots).`,
    `Change ONLY that component — do not touch anything else in the file.`,
    `Use only arcade design-token classes; no new imports beyond arcade / arcade/components / arcade-prototypes / react.`,
  ].join(" ");
}

/**
 * Fire a scoped Claude turn to expand an un-authored composite. Resolves ok
 * when the turn completes without error. Best-effort; the caller leaves the
 * frame as-is on !ok.
 */
export async function aiExpandFrame(
  slug: string,
  frameSlug: string,
  tag: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ ok: boolean }> {
  let ok = false;
  try {
    await runClaudeTurn({
      cwd: projectDir(slug),
      prompt: buildAiExpandPrompt(frameSlug, tag),
      bin: resolveClaudeBin(),
      signal: opts.signal,
      onEvent: (ev) => {
        if (ev.kind === "end") ok = ev.ok;
      },
    });
  } catch {
    return { ok: false }; // spawn error / threw
  }
  return { ok };
}
