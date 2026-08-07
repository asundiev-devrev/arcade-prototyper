/**
 * Should a Figma-URL prompt be BUILT by the generator, or transcribed by the
 * deterministic importer?
 *
 * Background: Studio has two Figma paths.
 *  - The deterministic importer (server/figma/kitEmitBranch.ts) traces the node
 *    tree into absolutely-positioned markup with real kit leaves. It runs NO
 *    LLM, so it CANNOT read a single word of the designer's prose. A bare
 *    "import this <url>" is exactly what it's for.
 *  - The Claude branch (runClaudeBranch → enrichPromptWithFigmaContext) pulls
 *    the same Figma design in as REFERENCE context — geometry, component
 *    identities, a ground-truth PNG, and a high-fidelity directive — then
 *    builds to the brief: modify a composite, wire an interaction, apply a
 *    theme, make an input functional.
 *
 * The old routing sent EVERY Figma-URL prompt (that wasn't @Computer or a
 * 2-URL wire-up) to the importer. So a rich brief like "implement this
 * precisely, modify the ComputerScene composite, make the input functional,
 * apply the purple theme to all the UI" was silently reduced to a pixel trace:
 * every instruction dropped, no composite reused, dead input, colours
 * hardcoded rather than themed. See the "figma-import-debug" session.
 *
 * This module judges INTENT so the middleware can hand any prompt carrying real
 * build intent to the generator, and keep the fast deterministic path only for
 * bare imports.
 *
 * Pure, keyword-based, and exported for unit testing — same shape as
 * detectInteractionIntent, which this composes with.
 */
import { detectInteractionIntent } from "../../src/lib/figmaUrl";
// The zero-import leaf, NOT fidelityDirective.ts. Both re-export the same
// function, but fidelityDirective carries 250 lines of Studio directive text
// naming the `figmanage` CLI, and this module is audited as part of the brain's
// host INPUT CONTRACT (__tests__/server/figma/headlessRouting.test.ts).
import { detectHiFiIntent } from "./hiFiIntent";

/**
 * Instructions the deterministic importer cannot honour because it has no LLM:
 * reuse/modify a composite as a base, make something functional/working, or
 * apply a theme across the UI. Any one of these means the designer wants the
 * design BUILT, not transcribed.
 *
 * Deliberately anchored to concrete build verbs so a plain
 * "import this from figma" / "bring this in" never trips it.
 */
const BUILD_INTENT_PATTERNS: RegExp[] = [
  // Reuse / modify / start-from an existing composite or template.
  /\b(?:modify|edit|update|change|extend|adapt|reuse|build\s+on|start\s+from|based\s+on)\b[^.]*\b(?:composite|template|scene|component|base|empty\s+state)\b/i,
  /\b(?:composite|template|scene|component|empty\s+state)\b[^.]*\bas\s+(?:a|the)\s+base\b/i,
  /\buse\s+(?:that|this|the)\b[^.]*\b(?:composite|template|scene|component)\b/i,
  // Functional / working behaviour (beyond static markup).
  /\b(?:functional|interactive|working)\b/i,
  /\bmust\b[^.]*\b(?:work|function)\b/i,
  /\bmake\b[^.]*\b(?:work|functional|interactive)\b/i,
  // Apply a theme / colour scheme across the UI.
  /\b(?:apply|applied|use)\b[^.]*\b(?:theme|colou?r\s+scheme|palette)\b/i,
  /\b(?:theme|colou?r\s+scheme|palette)\b[^.]*\b(?:applied|apply)\b[^.]*\b(?:all|entire|whole|every|nav|canvas|ui)\b/i,
  // Destructive / substitution edits: the deterministic importer can only
  // transcribe what the design contains — it cannot remove, swap, or rename a
  // part. Anchored to VERB + determiner so the bare word inside a quoted label
  // ("the CTA says 'Swap plan'") or a noun ("a delete button") does NOT fire.
  // The negative lookbehind rejects description-of-purpose ("this design WILL
  // replace the current page"). "drop" is deliberately EXCLUDED — remove/delete
  // cover the real edit, and "drop shadow" is the most common faithful-copy
  // phrase (this exact word over-blocked once before: commit 4b1aa4c).
  /(?<!\b(?:will|would|to|can|could|should|may|might)\s)\b(?:remove|delete|swap|replace|rename)\s+(?:the|this|that|these|those|all|a|an|its|their)\b/i,
  // A per-element dark/light recolor, imperative ("make the sidebar dark").
  // Excludes "make sure/certain" (ensure, not transform) and "make … match …
  // light/dark" (a comparison to the reference, not a recolor). Bounded,
  // comma-free span so it can't bridge unrelated clauses. Lookbehind rejects
  // purpose clauses ("this design will make...") same as the destructive-verb
  // pattern above.
  /(?<!\b(?:will|would|to|can|could|should|may|might)\s)\bmake\b(?!\s+(?:sure|certain))(?![^.,]*\bmatch)[^.,]{0,24}\b(?:dark|light)\b/i,
];

/**
 * True when the prompt asks for something the deterministic importer cannot
 * produce (a built/modified/functional/themed result), independent of hi-fi or
 * interaction intent.
 */
export function detectBuildIntent(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  return BUILD_INTENT_PATTERNS.some((re) => re.test(prompt));
}

/**
 * Verbs a designer uses when they are asking for a FRESH IMPORT of a node —
 * "import this", "bring this in", "grab this design", "pull it in from figma".
 *
 * Anchored to VERB + object so a noun ("the import failed") or a passing mention
 * does not fire, and deliberately narrow: this list only has to catch a designer
 * STATING an import ask, never infer that they might have meant one.
 */
const FRESH_IMPORT_PATTERNS: RegExp[] = [
  /\b(?:import|re-?import|bring|grab|pull|fetch)\s+(?:this|these|it|them|that|those)\b/i,
  /\b(?:import|re-?import|bring|grab|pull|fetch)\s+(?:the|a|an)\s+(?:\w+\s+){0,2}(?:design|frame|screen|node|page|component|nav|modal)\b/i,
  /\bfrom\s+figma\b/i,
  /\b(?:re-?import|reimport)\b/i,
  // AN OBJECTLESS IMPORT ASK — "please import <url>", "import", "grab <url>".
  // The patterns above all require an explicit object, so a designer whose object
  // IS the pasted link ("please import" + a URL) stated an import as plainly as
  // possible and was missed. Found by wiring layer 4: the turn became a
  // model-answered edit, and "please import" is about as stated as an import ask
  // gets. Before layer 4 nothing downstream noticed, because the miss only cost a
  // provenance divert that needed a node already in a frame.
  //
  // Anchored to END-OF-STRING (after any trailing URLs) so it cannot fire mid-
  // sentence: "the padding on this card is wrong <url>" and "fix the blur <url>"
  // must NOT match, and neither must corpus #1/#25/#32. Verified: this changes the
  // verdict on 0 of the 31 committed must-stay-deterministic strings.
  /\b(?:import|re-?import|reimport|bring|grab|pull|fetch)\b(?:\s+(?:in|this|it|them))?\s*(?:https?:\/\/\S+\s*)*$/i,
];

/**
 * Did the designer STATE that they want this node imported fresh, rather than an
 * existing frame edited?
 *
 * WHY THIS EXISTS — it protects the deterministic fast path from provenance.
 * Layer 2 (server/figma/provenance.ts) diverts a turn off the LLM-less importer
 * whenever the pasted node is already stamped inside a rendered frame. That is the
 * right call for corpus #1, a correction. But the importer stamps `data-figma-id`
 * on EVERY emitted child node — 38 plain ids across the 3 live frames of
 * `implement-this-precisely-3` — so once a designer has imported ONE frame,
 * pasting ANY node from inside it is a provenance hit. Measured (spec review,
 * 2026-08-06): with a reader over that live project, 38 of 38 stamped nodes routed
 * to an LLM edit turn for all five canonical fast-path phrasings, and 31 of 31
 * committed must-stay-deterministic strings flipped. A 16-26s no-model import
 * became a p50-32s generation turn that lost the fidelity guarantee, and the agent
 * was handed a directive saying "Do NOT create a new frame directory" — in answer
 * to a designer asking to import a frame.
 *
 * Deliberately re-importing a sub-component is an ORDINARY designer move, so the
 * rule is: provenance may divert a turn only when the designer has NOT asked for
 * an import. Two independent signals, both of which state the ask rather than
 * infer a mood — the standard turnConstraints.ts sets:
 *
 *  - FIDELITY WORDING (`detectHiFiIntent`): "Implement this precisely",
 *    "copy this exactly", "pixel-perfect build of this frame".
 *  - IMPORT VERBS (above): "import this", "bring this in", "grab this design".
 *  - A BARE URL with no prose at all — nothing to lose by importing, and it is
 *    the canonical fast-path ask. Handled by the caller, which is the only place
 *    that knows the URLs; see turnRouting.ts step 6.
 *
 * Measured cost of the veto: it is FALSE for corpus #1 (the motivating
 * correction), #2, #30 and #39, so every prompt this design fixes still diverts.
 * It is TRUE for all five committed fast-path phrasings. Pinned both ways in
 * __tests__/server/figma/planFigmaTurn.test.ts.
 *
 * Pure and host-agnostic — this module is BRAIN.
 */
export function detectFreshImportIntent(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  return detectHiFiIntent(prompt) || FRESH_IMPORT_PATTERNS.some((re) => re.test(prompt));
}

/**
 * Kit composites/templates a prompt may name as a "base" to eject and edit.
 * Kept to the whole-scene/page shapes designers actually reference by name;
 * extend as needed. Case-insensitive match, whole-word.
 */
export const EJECTABLE_COMPOSITES = [
  "ComputerScene",
  "ComputerPage",
  "SettingsPage",
  "VistaPage",
] as const;

/**
 * The ejectable composite the prompt names, or null. Matches the name anywhere
 * in the prompt (whole-word, case-insensitive) — it does NOT check for
 * base-language intent. Callers that use this to trigger an eject MUST also
 * verify build intent separately (that gate lives in detectComposeBaseIntent,
 * via detectBuildIntent). When multiple ejectable composites are named, returns
 * the first in EJECTABLE_COMPOSITES order.
 */
export function extractComposeBaseComposite(prompt: string): string | null {
  if (typeof prompt !== "string" || !prompt) return null;
  for (const name of EJECTABLE_COMPOSITES) {
    // whole-word, case-insensitive
    const named = new RegExp(`\\b${name}\\b`, "i");
    if (named.test(prompt)) return name;
  }
  return null;
}

/**
 * True when the prompt carries build intent AND names a known ejectable
 * composite as a base. This is a strict subset of detectBuildIntent (and
 * therefore of shouldGenerateFromFigma), so an eject can never happen on a
 * turn that routed to the deterministic importer (review M5).
 */
export function detectComposeBaseIntent(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  return detectBuildIntent(prompt) && extractComposeBaseComposite(prompt) !== null;
}

/**
 * Decide whether a Figma-URL prompt should go to the LLM generator (design as
 * reference) instead of the deterministic importer.
 *
 * Fires on ANY of:
 *  - interaction intent ("click opens a modal", "on hover show …"),
 *  - build intent (modify a composite, make it functional, apply a theme,
 *    remove/swap/replace an element).
 *
 * A faithful-reproduction ask (bare import, or "implement precisely" with no
 * build/interaction instruction) matches none of these and stays on the fast
 * deterministic path.
 */
export function shouldGenerateFromFigma(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  // Hi-fi wording ("precisely", "pixel-perfect") is deliberately NOT a routing
  // trigger: a faithful-reproduction ask belongs on the deterministic kit-emit
  // engine (fidelity by construction), not the LLM reconstructor. Only intent
  // the importer cannot honour — interactivity or a build/edit instruction —
  // routes to the generator. detectHiFiIntent still governs the LLM's directive
  // inside runClaudeBranch; it just no longer decides the engine.
  return detectInteractionIntent(prompt) || detectBuildIntent(prompt);
}
