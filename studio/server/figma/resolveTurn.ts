/**
 * Layer 4 — the HOST-ANSWERED question, and nothing else.
 *
 * When the deterministic layers are exhausted and the turn is still ambiguous, the
 * routing layer does NOT call a model. It RETURNS A QUESTION and lets the host
 * answer it. That inversion is the whole design, and it exists because of who the
 * users are: the designers do not use the Studio desktop app, they work in their
 * own Cursor / Claude Code, and only 2 of the team have ever opened the .dmg. In
 * those hosts the brain is ALREADY executing inside a model turn, so spawning a
 * nested `claude --print` there would be an unexpected subprocess, needing
 * credentials the host owns, to ask a question the agent reading the prompt could
 * answer for free.
 *
 * So the seam is two lines to implement:
 *
 *     resolveTurn?: (q: TurnQuestion) => Promise<TurnAnswer>
 *
 *   - a Claude-Code / Computer host answers INLINE — zero subprocess, zero added
 *     latency, because the model is already in the loop;
 *   - Studio answers by spawning its CLI, in
 *     server/figma/adapters/studioCliResolver.ts — an ADAPTER, off this module's
 *     import graph, which a headless host can ignore entirely;
 *   - a host that supplies NOTHING keeps today's behaviour (see the outcome note
 *     below).
 *
 * THIS MODULE IS BRAIN. No subprocess, no filesystem, no `process.env`, no Studio
 * path, no Electron. The static guard in
 * __tests__/server/figma/headlessRouting.test.ts enforces that transitively and
 * lists this file as a brain entrypoint, so a future edit that reaches for
 * `node:child_process` fails a test rather than silently un-shipping the seam in
 * every host but one. Compare `import-hook-dead-in-dmg` one level up: a dev-only
 * path disabled a whole feature on tester machines while every test stayed green.
 *
 * Unit-tested in __tests__/server/figma/resolveTurn.test.ts, entirely with fake
 * resolvers — no model is ever invoked by the suite.
 */
import { z } from "zod";
import type { ProvenanceResult } from "./provenance";

/**
 * What the routing layer could not decide, handed over with everything it knows.
 *
 * Deliberately FLAT and Studio-free: a prompt, the pasted node ids, the frames the
 * host told us about, and what provenance found. A host implementing this needs to
 * understand nothing about Studio — which is the test the brief sets for the seam
 * ("if a host has to understand Studio internals to implement it, the seam is
 * wrong").
 */
export interface TurnQuestion {
  /** The designer's prompt, verbatim. The host may read it; it is never parsed
   *  here. */
  prompt: string;
  /** The Figma node ids pasted in the prompt, colon-form. */
  nodeIds: string[];
  /**
   * The frames the host offered, if any. This doubles as the ALLOW-LIST for the
   * answer's `targetFrame` — see `resolveTurnOrFallback`. A host with no frame list
   * passes `[]`, and then no frame name is accepted, because an empty allow-list is
   * an empty allow-list.
   */
  frameSlugs: string[];
  /** What layer 2 found, so the host is not asked to re-derive it. */
  provenance: ProvenanceResult;
}

/**
 * The three things a turn can be. Intentionally the SAME vocabulary as the
 * cascade's own branches so a host answer maps onto a route with no translation
 * table:
 *   - `import` — a fresh deterministic import (the fast path)
 *   - `edit`   — a change to something that already exists
 *   - `wire`   — an interaction between two designs
 */
export const TurnKindSchema = z.enum(["import", "edit", "wire"]);

/**
 * The answer schema.
 *
 * A HOST IS UNTRUSTED INPUT, and that is not paranoia — it is the lesson of
 * `locateNodeProvenance`, whose host-supplied reader shipped with a `?? []` that
 * caught `null` and `undefined` but let every other non-array reach `.filter`,
 * throwing a TypeError that failed the designer's whole turn. A foreign host
 * returning a single unwrapped object, a `Map`, or an unparsed JSON string is a
 * plausible mistake, so it is validated rather than trusted, and the cost of a bad
 * answer is "no answer", never "the turn died".
 *
 * `constraints` DEFAULTS rather than being required: a host that answers only the
 * question we asked should not be punished for it. `.strict()` is deliberately NOT
 * used — a host that returns extra keys (a rationale, a confidence) is being
 * helpful, and we simply ignore them.
 */
export const TurnAnswerSchema = z.object({
  kind: TurnKindSchema,
  /** Which existing frame this turn edits, when the host can name one. Verified
   *  against the question's `frameSlugs` before it is ever used. */
  targetFrame: z.string().min(1).optional(),
  /** Same closed set as turnConstraints.ts. Kept as a literal union rather than
   *  `z.string()` so a host inventing a constraint we have no directive for is a
   *  validation failure, not a silently-dropped instruction. */
  constraints: z.array(z.literal("single-frame")).default([]),
});

export type TurnAnswer = z.infer<typeof TurnAnswerSchema>;

/** The host's capability. Two lines, no Studio vocabulary — that is the point. */
export type TurnResolver = (q: TurnQuestion) => Promise<unknown>;

export interface ResolveTurnDeps {
  /** Absent ⇒ the turn is `unasked` and the cascade keeps today's decision. */
  resolveTurn?: TurnResolver;
}

export interface ResolveTurnOptions {
  /**
   * How long the host gets. Enforced HERE and not only in the adapter, because an
   * INLINE host has no subprocess to kill and could await forever — the seam has to
   * hold the guarantee for every host, not just the one that spawns.
   */
  timeoutMs?: number;
}

/**
 * `unasked` and `failed` ARE DIFFERENT, and the distinction is the one place this
 * design departs from its brief — on measurement, recorded here so the next reader
 * does not "fix" it back.
 *
 * The brief says: "NO adapter supplied -> fall back to the generator. Never to the
 * importer." Applied literally to the ABSENT case, that converts 9 of the 31
 * committed must-stay-deterministic faithful-copy strings (measured 2026-08-06,
 * §0.1 of the spec) from a 16-26s no-model import into a p50 98s generation turn
 * whenever no adapter is supplied — i.e. it destroys the deterministic fidelity
 * guarantee in exactly the headless host the seam exists to serve. That guarantee
 * is what the dominant Figma-import lane is built on (auto-memory
 * `figma-import-is-the-dominant-usecase`).
 *
 * So the rule is split by CASE, and hard constraint 1 is honoured in full for the
 * case it actually describes:
 *   - `unasked` — nobody to ask. Keep today's decision. Nothing was attempted, so
 *     nothing was lost, and no host is penalised for not implementing an optional
 *     capability.
 *   - `failed`  — WE ASKED AND GOT NOTHING (threw, timed out, unparseable,
 *     schema-mismatched). Fall back to the GENERATOR, which at least reads the
 *     prompt. NEVER to the deterministic importer: backwards would re-create the
 *     original instruction-loss bug on every resolver hiccup.
 * The routing layer branches on exactly this, and planFigmaTurn.test.ts pins both
 * directions.
 */
export type ResolveOutcome = "resolved" | "failed" | "unasked";

export interface ResolveTurnResult {
  outcome: ResolveOutcome;
  /** Set only when `outcome === "resolved"`. */
  answer?: TurnAnswer;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Ask the host, and never let the asking hurt the turn.
 *
 * NEVER THROWS, for any input, from any resolver. Callers have no try block by
 * design — the same contract `locateNodeProvenance` makes, for the same reason: a
 * layer that is an OPTIMISATION must not be able to fail the designer's turn. Every
 * way a host can misbehave lands on `failed`.
 */
export async function resolveTurnOrFallback(
  question: TurnQuestion,
  deps?: ResolveTurnDeps,
  opts: ResolveTurnOptions = {},
): Promise<ResolveTurnResult> {
  const resolver = deps?.resolveTurn;
  if (typeof resolver !== "function") return { outcome: "unasked" };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let raw: unknown;
  try {
    // The resolver is called inside the try so a SYNCHRONOUS throw (a host that
    // isn't `async`) is caught too — `await resolver(...)` outside one would escape.
    raw = await withTimeout(resolver(question), timeoutMs);
  } catch {
    return { outcome: "failed" };
  }

  const check = TurnAnswerSchema.safeParse(raw);
  if (!check.success) return { outcome: "failed" };

  // THE INJECTION GUARD. `targetFrame` becomes a real instruction ("edit `<slug>`
  // in place"), so a name we cannot verify is worse than no name: the agent is sent
  // to edit a frame that may not exist, and it will try. The question already
  // carries the candidate list, so this is checkable without trusting the host.
  //
  // The KIND survives an unverifiable frame name — that is the host's judgement
  // about what sort of turn this is and needs no allow-list — but the name itself
  // is dropped. Downgrading the whole answer would throw away good information
  // because one field was wrong.
  const offered = Array.isArray(question?.frameSlugs) ? question.frameSlugs : [];
  const targetFrame =
    check.data.targetFrame && offered.includes(check.data.targetFrame)
      ? check.data.targetFrame
      : undefined;

  return { outcome: "resolved", answer: { ...check.data, targetFrame } };
}

/**
 * Reject after `ms`. A hanging host is the failure mode with no natural bound: the
 * adapter can SIGTERM its child, but an inline host cannot be killed, so the wait
 * is capped here for everyone.
 *
 * The timer is always cleared, including on the happy path — a leaked timer keeps
 * the process alive, which in a CLI host means a command that will not exit.
 */
function withTimeout<T>(p: Promise<T> | T, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("resolveTurn timed out")), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
