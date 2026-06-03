import { randomUUID } from "node:crypto";
import { runComputerTurn } from "./computerAgent";
import { buildComputerContext } from "./computerContext";
import { addChimeIn, pendingObjections } from "../chimeIns";
import { getProject, updateProject, readHistory } from "../projects";

/**
 * Silent product-truth watcher. After the code agent writes a frame, we ask
 * the Computer (DevRev agent/620) whether the prototype drifts from how
 * DevRev actually works — judged on its general product knowledge, NOT live
 * org data (which it fabricates). The instruction biases hard toward silence:
 * a "looks fine" is never surfaced.
 */
export const DRIFT_CHECK_INSTRUCTION =
  "You are a DevRev product expert reviewing a prototype a designer just " +
  "generated. Your job is to catch where it contradicts how DevRev actually " +
  "works as a product — wrong object model, impossible workflow, wrong user " +
  "role, or an action with consequences DevRev would never allow. Judge from " +
  "your general DevRev product knowledge, NOT live org data.\n\n" +
  "Look hard at the designer's request and the frame description below. Examples " +
  "of drift worth flagging: deleting a ticket also deleting the customer/account; " +
  "a ticket auto-closing the moment it is assigned; a Rev (customer) user seeing " +
  "Dev-only internal tools; merging parts in a way DevRev doesn't support; a state " +
  "transition that isn't reachable in DevRev's workflow.\n\n" +
  "If you find a real contradiction, reply with ONE or TWO sentences naming it " +
  "concretely. Lean toward flagging when the designer's intent clearly conflicts " +
  "with DevRev behavior. Only reply with exactly NONE (and nothing else) when the " +
  "prototype is genuinely consistent with how DevRev works.";

/** Returns the objection text, or null when the agent declined to chime in. */
export function parseDriftResponse(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Treat a bare "NONE" (any case, optional trailing punctuation) as silence.
  if (/^none[.!\s]*$/i.test(trimmed)) return null;
  return trimmed;
}

export interface RunDriftCheckDeps {
  /** Pre-rendered frame source block, e.g. from readFrameSources(slug). */
  frameSource: string;
  /** Frame slug the chime-in is about (the changed frame). */
  frameSlug: string;
}

/**
 * Fire-and-forget: never throws. Builds context, calls Computer, persists a
 * chime-in if there's a real objection. Failures are logged and dropped — a
 * background watcher must never nag.
 */
export async function runDriftCheck(slug: string, deps: RunDriftCheckDeps): Promise<void> {
  try {
    const project = await getProject(slug);
    if (!project) return;

    const history = await readHistory(slug);
    const recentHistory = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));

    // The designer's most recent prompt states the intended BEHAVIOR — which
    // the structural frame summary (components + visible text) can't convey.
    // Surface it explicitly so Computer can judge intent, not just layout.
    const lastUserPrompt = [...history].reverse().find((m) => m.role === "user")?.content?.trim();
    const projectSummary = lastUserPrompt
      ? `Project: ${project.name} (theme: ${project.theme}).\nDesigner's latest request: "${lastUserPrompt}"`
      : `Project: ${project.name} (theme: ${project.theme}).`;

    const context = buildComputerContext({
      projectSummary,
      pendingChimeIns: pendingObjections(project.chimeIns ?? []),
      frameSource: deps.frameSource,
      recentHistory,
    });

    let assistantText = "";
    const result = await runComputerTurn({
      prompt: `${DRIFT_CHECK_INSTRUCTION}\n\n---\n${context}`,
      conversationId: project.computerConversationId,
      timeoutMs: 60_000,
      onEvent: (ev) => {
        if (ev.kind === "narration") assistantText = ev.text;
      },
    });

    const objection = parseDriftResponse(result.assistantText || assistantText);
    if (!objection) return;

    const fresh = await getProject(slug);
    if (!fresh) return;
    const nextList = addChimeIn(fresh.chimeIns ?? [], {
      id: `ci-${randomUUID()}`,
      frameSlug: deps.frameSlug,
      objection,
      createdAt: new Date().toISOString(),
    });
    // addChimeIn dedups; only persist when the list actually grew.
    if (nextList.length !== (fresh.chimeIns ?? []).length) {
      await updateProject(slug, { chimeIns: nextList });
    }
  } catch (err) {
    console.warn(`[studio] drift check failed for ${slug}:`, err);
  }
}
