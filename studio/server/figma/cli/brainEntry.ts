/**
 * The brain's public surface, as ONE module — the bundle entrypoint for
 * `planTurn.mjs` and the shape any non-Studio host consumes.
 *
 * Why a dedicated entry rather than importing the modules directly from the CLI:
 * this file is the single place that declares "these are the brain's exports."
 * Adding something Studio-only here would pull it into every host's bundle, so the
 * transitive-closure guard in __tests__/server/figma/headlessRouting.test.ts lists
 * this file as a brain entrypoint — a re-coupling fails a test instead of quietly
 * shipping a Studio dependency to Claude Code.
 *
 * Everything re-exported here must be pure: no subprocess, no filesystem, no
 * process.env, no Studio path, no Electron. The host supplies its capabilities
 * (frame reading, and optionally a turn resolver) as injected functions.
 */
export { planFigmaTurn, classifyFigmaTurn, isScopedEditTurn } from "../turnRouting";
export type { FigmaTurnPlan, FigmaTurnInputs, FigmaTurnKind, TurnConstraint } from "../turnRouting";
export { buildTurnDirectives, shouldSuppressWholeFrame } from "../turnDirectives";
export { detectTurnConstraints, buildSingleFrameDirective } from "../turnConstraints";
export { locateNodeProvenance } from "../provenance";
export type { FrameSource, FrameSourceReader, NodeRef } from "../provenance";
export { parseFigmaUrl } from "../figmaNodeUrl";
export type { ParsedFigmaUrl } from "../figmaNodeUrl";
export { extractFigmaUrls, extractFigmaUrl, detectInteractionIntent } from "../../../src/lib/figmaUrl";
export { shouldGenerateFromFigma } from "../generationIntent";
