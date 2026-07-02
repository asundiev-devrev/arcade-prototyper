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
 * detectHiFiIntent / detectInteractionIntent, which this composes with.
 */
import { detectHiFiIntent } from "./fidelityDirective";
import { detectInteractionIntent } from "../../src/lib/figmaUrl";

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
 * The ejectable composite the prompt names as a base, or null. Requires the
 * name to appear near base-language (modify / use … as base / based on) so a
 * passing mention ("looks like ComputerScene") doesn't trigger an eject.
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
 *  - hi-fi intent ("implement precisely", "pixel-perfect", "match exactly"),
 *  - interaction intent ("click opens a modal", "on hover show …"),
 *  - build intent (modify a composite, make it functional, apply a theme).
 *
 * A bare import (URL only, or "import/bring this in") matches none of these and
 * stays on the fast deterministic path.
 */
export function shouldGenerateFromFigma(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  return (
    detectHiFiIntent(prompt) ||
    detectInteractionIntent(prompt) ||
    detectBuildIntent(prompt)
  );
}
