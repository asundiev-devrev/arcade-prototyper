// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planFigmaTurn, type FigmaTurnInputs } from "../../../server/figma/turnRouting";
import { shouldGenerateFromFigma } from "../../../server/figma/generationIntent";
import { detectInteractionIntent, extractFigmaUrls } from "../../../src/lib/figmaUrl";
// parseFigmaUrl from the zero-import LEAF, not figmaCli: these tests assert the
// brain is loadable in a host with no CLI binary, so importing the figmanage
// driver here would make the claim untrue in the file that makes it.
import { parseFigmaUrl } from "../../../server/figma/figmaNodeUrl";

/**
 * THE POINT OF THE WHOLE DESIGN.
 *
 * The designers do not use the Studio desktop app — they work in their own Cursor
 * / Claude Code, and only 2 of the team have ever opened the .dmg. So the routing
 * layer has to be BRAIN: it must produce correct plans in a host that supplies no
 * filesystem accessor, no CLI binary, no Electron, and possibly isn't even macOS.
 *
 * Two guarantees are tested here, and they are different:
 *   1. BEHAVIOURAL — call planFigmaTurn with NO deps at all and assert every
 *      corpus Figma prompt still produces a sane plan.
 *   2. STRUCTURAL — the brain modules' TRANSITIVE import closure stays clean.
 *      Behaviour alone is not enough: an eagerly-loaded Studio path breaks the
 *      module at IMPORT time in a foreign host, before any of our assertions run.
 *
 * Guarantee 2 is modelled on `import-hook-dead-in-dmg`: a dev-only path silently
 * disabled a whole feature on tester machines while every test stayed green.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const corpus = require("../../fixtures/designer-prompts.json") as {
  prompts: Array<{ i: number; isCorrection: boolean; text: string }>;
};
const P = (i: number) => corpus.prompts[i].text;

function inputsFor(prompt: string): FigmaTurnInputs & { nodeIds: string[] } {
  const urls = extractFigmaUrls(prompt);
  return {
    hasFigmaNode: urls.length > 0,
    wantsGeneration: urls.length > 0 ? shouldGenerateFromFigma(prompt) : false,
    hasInteractionIntent: detectInteractionIntent(prompt),
    figmaUrlCount: urls.length,
    prompt,
    nodeIds: urls
      .map((u) => parseFigmaUrl(u)?.nodeId)
      .filter((n): n is string => Boolean(n)),
  };
}

describe("planFigmaTurn with NO host capability at all", () => {
  it("produces a valid plan for every corpus Figma prompt, and never throws", async () => {
    const figma = corpus.prompts.filter((p) => extractFigmaUrls(p.text).length > 0);
    expect(figma.length).toBe(13);
    for (const p of figma) {
      // No deps argument WHATSOEVER — not `{}`, not `{ readFrames: undefined }`.
      const plan = await planFigmaTurn(inputsFor(p.text));
      expect(["kit-emit", "wire", "claude"], `#${p.i}`).toContain(plan.kind);
      expect(Array.isArray(plan.constraints), `#${p.i}`).toBe(true);
      expect(typeof plan.decidedBy, `#${p.i}`).toBe("string");
    }
  });

  // …AND `kit-emit` IS THE MOST HOST-DEPENDENT ANSWER THE CASCADE GIVES, which is the
  // opposite of what an earlier framing of this test claimed. It means "run
  // server/figma/kitEmitBranch.ts", whose closure is ~29 modules reaching paths.ts,
  // projects.ts, figmaCli.ts (the `figmanage` binary) and claudeBin.ts — a module the
  // guard below lists as FORBIDDEN for the brain. A foreign host needs a Figma PAT,
  // the CLI, the emitter and a frames dir to execute it.
  //
  // So this assertion is about ROUTING STABILITY (the plan is the same everywhere),
  // NOT about portability of the outcome. Measured, 6 of the 13 corpus Figma prompts
  // come back `kit-emit` with zero directives, i.e. a decision a Cursor / Claude Code
  // host can neither run nor read. That is the design's largest headless gap and it is
  // recorded as §9 item 11 of the spec, not fixed here — degrading it to `claude` would
  // hand the dominant Figma-import lane from a 16-26s deterministic trace to a p50 98s
  // LLM reconstruction, the trade §0 rejects twice.
  it("still settles the bare imports on the deterministic fast path", async () => {
    const bare: string[] = [];
    for (const i of [0, 37, 45, 53]) {
      const plan = await planFigmaTurn(inputsFor(P(i)));
      expect(plan.kind, `#${i}`).toBe("kit-emit");
      expect(plan.constraints, `#${i}`).toEqual([]);
      bare.push(`#${i}`);
    }
    expect(bare.length).toBe(4);
  });

  // The gap above, MEASURED rather than described, so it cannot drift silently: how
  // many real Figma prompts leave the cascade with a kind a foreign host cannot
  // execute AND no words it can read? If this number moves in either direction,
  // someone changed the headless story and should say so.
  //
  // It is SEVEN, not six — #1 joins the list in this host, because provenance needs a
  // reader and a bare Claude Code host supplies none, so the motivating correction
  // falls through to the importer too. The four bare imports are correct-but-unrunnable;
  // #1, #25 and #32 are prose the host is handed no way to honour.
  it("7 of the 13 corpus Figma prompts return a Studio-only decision with no directives", async () => {
    const { buildTurnDirectives } = await import("../../../server/figma/turnDirectives");
    const stuck: number[] = [];
    for (const p of corpus.prompts.filter((x) => extractFigmaUrls(x.text).length > 0)) {
      const plan = await planFigmaTurn(inputsFor(p.text));
      if (plan.kind === "kit-emit" && buildTurnDirectives(plan).length === 0) stuck.push(p.i);
    }
    expect(stuck).toEqual([0, 1, 25, 32, 37, 45, 53]);
  });

  // L3 needs ZERO host capability, so the single-frame fix — the live failure this
  // branch exists for — lands in a Claude Code host with nothing injected at all.
  it("still fixes #30 with zero host capability (L3 is pure)", async () => {
    const plan = await planFigmaTurn(inputsFor(P(30)));
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("constraints");
    expect(plan.constraints).toEqual(["single-frame"]);
  });

  // THE HONEST COST OF NO HOST, asserted rather than glossed. Provenance is the
  // one layer that needs a capability, so a host supplying no frame reader gets
  // TODAY's behaviour for #1 — not a crash, not a wrong answer. A Claude-Code host
  // that hands over files it already has in context gets the fix.
  it("degrades #1 to today's behaviour rather than failing (provenance needs a reader)", async () => {
    const plan = await planFigmaTurn(inputsFor(P(1)));
    expect(plan.kind).toBe("kit-emit");
    expect(plan.decidedBy).toBe("default");
  });

  it("a no-Figma prompt is inert with no deps", async () => {
    const plan = await planFigmaTurn(
      inputsFor("New screen: an error state with a Try again button"),
    );
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("no-node");
    expect(plan.constraints).toEqual([]);
  });
});

/**
 * The static guard. A per-FILE grep is not enough and this was proven, not
 * assumed: an earlier draft had provenance.ts import `frameNameFromNode` from
 * kitEmitBranch.ts, whose closure reaches server/paths.ts (os.homedir() +
 * ~/Library/Application Support/arcade-studio), server/figmaCli.ts
 * (node:child_process → figmanage) and server/claudeBin.ts. A grep of
 * provenance.ts's own source finds nothing and passes green while the brain is
 * fully re-coupled to the app. So this walks the TRANSITIVE closure of relative
 * imports and reports the offending CHAIN.
 *
 * Also note the needle choice: greping for the literal "server/paths" can never
 * match, because every module in server/ uses relative imports ("./paths",
 * "../paths"). A guard that cannot fail is worse than no guard, so we resolve
 * imports and check the RESOLVED PATH instead.
 */
const SERVER_DIR = path.resolve(__dirname, "../../..");

/**
 * The routing layer itself, PLUS the plan→words translation.
 *
 * `turnDirectives.ts` is on this list because a plan is useless on its own: until
 * it existed the translation lived in `server/middleware/chat.ts`, whose value
 * closure is 61 modules and reaches `server/paths.ts`, `claudeBin.ts` and
 * `awsPreflight.ts` (`child_process`). A Claude-Code host therefore got a CORRECT
 * plan for corpus #30 — the live 2026-08-06 failure — and nowhere to act on it, so
 * the fix existed inside the .dmg only, which is the one host the designers do not
 * use. Being on this list is what stops that regressing.
 */
const BRAIN_ENTRYPOINTS = [
  "server/figma/turnRouting.ts",
  "server/figma/provenance.ts",
  "server/figma/turnConstraints.ts",
  "server/figma/turnDirectives.ts",
  "server/figma/frameSlug.ts",
  // LAYER 4's SEAM, and being on this list is the entire point of building it the
  // way it is built. The obvious implementation of "ask a model which kind of turn
  // this is" is a `claude --print` subprocess — the systemSynth.ts shape — and that
  // presumes a host owning a CLI binary and Bedrock credentials. In Claude Code /
  // Computer the brain is ALREADY inside a model turn, so a nested spawn there is
  // wrong twice over. So the seam RETURNS A QUESTION and the host answers it; the
  // subprocess lives in server/figma/adapters/studioCliResolver.ts, which is
  // deliberately NOT on this list and which this module never imports. If someone
  // ever "simplifies" the seam by calling the CLI directly, this guard fails.
  "server/figma/resolveTurn.ts",
  // `detectHiFiIntent` + its patterns, as a zero-import leaf. It is BRAIN because
  // the cascade calls it (via detectFreshImportIntent, to protect the
  // deterministic fast path from a provenance divert) and because a foreign host
  // must be able to compute `shouldSuppressWholeFrame`'s `ctx.explicitHiFi`.
  // Extracted from fidelityDirective.ts, whose 250 lines of directive text name
  // the `figmanage` CLI and stay off this list.
  "server/figma/hiFiIntent.ts",
];

/**
 * THE INPUT CONTRACT — every module a foreign host must import in order to CALL
 * the cascade at all. Auditing only the routing layer measured the wrong thing:
 * `planFigmaTurn` takes `nodeIds`, `wantsGeneration` and `hasInteractionIntent`,
 * so a host cannot produce its arguments without these. If one of them drags in
 * `node:child_process`, the seam costs the host exactly what the brain refused to
 * pay, and a per-entrypoint audit of the brain alone cannot see it.
 *
 * That was a real gap: `parseFigmaUrl` used to live only in `server/figmaCli.ts`,
 * whose first line is `import { spawn } from "node:child_process"` and which
 * shells out to the `figmanage` binary — a module this very guard lists as
 * FORBIDDEN for the brain. So the contract required of the host what the brain was
 * forbidden to touch. It now lives in a zero-import leaf and figmaCli re-exports
 * it, so existing call sites are unchanged.
 */
const HOST_GLUE_ENTRYPOINTS = [
  "server/figma/figmaNodeUrl.ts", // parseFigmaUrl — nodeIds
  "server/figma/generationIntent.ts", // wantsGeneration
  "src/lib/figmaUrl.ts", // extractFigmaUrls + detectInteractionIntent
];

/**
 * Source shapes a brain module may not contain.
 *
 * WIDENED after a spec review poisoned `turnConstraints.ts` eight ways and SEVEN
 * of them left all 18 tests green. The original list matched only a static
 * `import … from "node:<builtin>"`, so every other way to couple a brain module to
 * a host slipped past: a BARE specifier (`from "fs"` — valid, resolves identically,
 * and what an outside contributor or a Claude Code session writes), a DYNAMIC
 * import, `createRequire` (this repo's own established idiom — 4 live sites under
 * server/), `process.cwd()`, `os.homedir()`, and a hardcoded
 * `~/Library/Application Support/arcade-studio` literal — the one thing the brief
 * names explicitly as forbidden.
 *
 * `FORBIDDEN_MODULES` only helps when the coupling routes through one of six named
 * Studio files; a direct builtin import or a path literal bypasses it entirely. The
 * `import-hook-dead-in-dmg` failure was exactly this shape one level up: green
 * tests, dead feature.
 *
 * Every needle here is proven to FIRE against a fixture in the self-test below, and
 * proven NOT to fire on ordinary brain code. Adding a needle without both is how the
 * blind spot reopens.
 */
const FORBIDDEN_SOURCE = [
  // Node builtins, static import, `node:`-prefixed OR bare. Both are valid and
  // resolve identically; the guard used to see only the prefixed form.
  /\bfrom\s+["'](?:node:)?(?:fs|fs\/promises|child_process|os|module|path|worker_threads|net|http|https|dns|tls|cluster|v8|vm|repl|readline|inspector)["']/,
  // Dynamic import of a builtin — same coupling, later.
  /\bimport\s*\(\s*["'](?:node:)?(?:fs|fs\/promises|child_process|os|module|path)["']\s*\)/,
  // CommonJS interop. `createRequire` is this repo's idiom for reaching builtins,
  // so it is banned by NAME rather than by what it is used for.
  /\bcreateRequire\s*\(/,
  /\brequire\s*\(\s*["']/,
  /\bfrom\s+["']electron["']/,
  // Host environment. `process.env` was already here; the others are the same
  // question ("where am I running?") asked differently.
  /\bprocess\.env\b/,
  /\bprocess\.cwd\s*\(/,
  /\bos\.homedir\s*\(/,
  // The literal the brief forbids by name. A module can hardcode this without
  // importing anything at all.
  /Library\/Application Support\/arcade-studio/,
];

/** Modules the brain must never be able to reach, by resolved path suffix. */
const FORBIDDEN_MODULES = [
  "server/paths.ts",
  "server/projects.ts",
  "server/claudeBin.ts",
  "server/figmaCli.ts",
  "server/figmaIngest.ts",
  "server/figma/kitEmitBranch.ts",
];

/**
 * Strip comments before matching. The first version of this guard failed on all
 * four brain modules — every one of them DOCUMENTS the rule ("must not read
 * process.env"), and a naive source grep cannot tell a prohibition from a
 * violation. A guard that fires on its own documentation trains people to delete
 * the documentation.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block + JSDoc
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 "); // line comments, keeping "http://"
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // bare package specifier — not our tree
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Every module reachable from `entry` via relative imports, with the chain that
 *  got there. */
function closureOf(entry: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (file: string, chain: string[]) => {
    if (out.has(file)) return;
    out.set(file, chain);
    const src = fs.readFileSync(file, "utf8");
    // Covers `import x from "y"`, `import "y"`, `export … from "y"`, and
    // `await import("y")`.
    const specs = [
      ...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      const resolved = resolveImport(file, spec);
      if (resolved) walk(resolved, [...chain, path.relative(SERVER_DIR, resolved)]);
    }
  };
  walk(path.resolve(SERVER_DIR, entry), [entry]);
  return out;
}

describe("brain modules stay decoupled from Studio (transitive)", () => {
  it.each([...BRAIN_ENTRYPOINTS, ...HOST_GLUE_ENTRYPOINTS])(
    "%s has a clean transitive closure",
    (entry) => {
      const closure = closureOf(entry);
      const violations: string[] = [];

      for (const [file, chain] of closure) {
        const rel = path.relative(SERVER_DIR, file);
        for (const bad of FORBIDDEN_MODULES) {
          if (rel === bad) violations.push(`reaches ${bad} via ${chain.join(" -> ")}`);
        }
        const src = codeOnly(fs.readFileSync(file, "utf8"));
        for (const re of FORBIDDEN_SOURCE) {
          if (re.test(src)) {
            violations.push(`${rel} matches ${re} (via ${chain.join(" -> ")})`);
          }
        }
      }
      expect(violations, `${entry}:\n${violations.join("\n")}`).toEqual([]);
    },
  );

  // A GUARD THAT CANNOT FAIL IS WORSE THAN NO GUARD. Prove this one detects both
  // failure shapes it exists for, using a module we know is dirty:
  // kitEmitBranch.ts imports node:fs directly AND reaches server/paths.ts. If
  // either assertion below stops holding, the guard above has silently become
  // decorative — which is exactly how the import-hook-dead-in-dmg guard passed
  // green while the feature was dead on every tester's machine.
  it("the guard actually detects a dirty closure (self-test)", () => {
    const closure = closureOf("server/figma/kitEmitBranch.ts");
    const rels = [...closure.keys()].map((f) => path.relative(SERVER_DIR, f));
    // Shape 1: reaches a forbidden MODULE transitively.
    expect(rels).toContain("server/paths.ts");
    // Shape 2: forbidden SOURCE pattern survives comment-stripping.
    const dirty = codeOnly(
      fs.readFileSync(path.resolve(SERVER_DIR, "server/figma/kitEmitBranch.ts"), "utf8"),
    );
    expect(FORBIDDEN_SOURCE.some((re) => re.test(dirty))).toBe(true);
  });

  // And prove comment-stripping did not neuter the source check: a prohibition in
  // prose must pass, a real access must fail.
  it("codeOnly strips prose but keeps real code", () => {
    expect(/\bprocess\.env\b/.test(codeOnly("// never read process.env here"))).toBe(false);
    expect(/\bprocess\.env\b/.test(codeOnly("/** no process.env */"))).toBe(false);
    expect(/\bprocess\.env\b/.test(codeOnly("const x = process.env.FOO;"))).toBe(true);
  });

  // EVERY NEEDLE MUST BE PROVEN TO FIRE, not just the two shapes kitEmitBranch.ts
  // happens to exhibit. A spec review poisoned `turnConstraints.ts` eight ways and
  // SEVEN of them left all 18 tests green: bare-specifier builtins (`from "fs"`),
  // dynamic `await import("node:fs")`, `createRequire` + `require("path")`,
  // `process.cwd()`, and a hardcoded `~/Library/Application Support/arcade-studio`
  // literal — the one thing the brief names explicitly as forbidden. Two of those
  // are not hypothetical: `createRequire` is this repo's established idiom for
  // reaching builtins (4 live sites under server/), and the guard's self-test could
  // not surface any of it, because it only ever proved the needles that already
  // matched.
  //
  // A guard is worth exactly its demonstrated failure modes. So each needle gets a
  // fixture string here; adding a needle without a fixture is what let this reopen.
  it("every FORBIDDEN_SOURCE needle fires against a real violation shape", () => {
    const mustCatch = [
      'import fs from "node:fs";',
      'import fs from "node:fs/promises";',
      'import { spawn } from "node:child_process";',
      'import os from "node:os";',
      'import { app } from "electron";',
      "const home = process.env.HOME;",
      // The seven shapes that slipped through before this block existed.
      'import fs from "fs";',
      'import path from "path";',
      'import os from "os";',
      'import { spawn } from "child_process";',
      'import { createRequire } from "node:module";',
      'const fs = await import("node:fs");',
      'const req = createRequire(import.meta.url); const fs = req("fs");',
      "const root = process.cwd();",
      "const home = os.homedir();",
      'const STUDIO = "/Users/x/Library/Application Support/arcade-studio/projects";',
    ];
    for (const shape of mustCatch) {
      expect(
        FORBIDDEN_SOURCE.some((re) => re.test(shape)),
        `no needle catches: ${shape}`,
      ).toBe(true);
    }
  });

  // …and the widened needles must not fire on ORDINARY brain code, or the guard
  // becomes a nuisance and someone deletes it. These are the shapes the real
  // modules contain: relative imports, type imports, and prose about the rule.
  it("the widened needles do not fire on ordinary brain code", () => {
    const mustPass = [
      'import { slugMatchesNode } from "./frameSlug";',
      'import type { FigmaTurnPlan } from "./turnRouting";',
      'import { isScopedEditPrompt } from "../../src/lib/scopedEdit";',
      "const requires = fields.filter(Boolean);", // "require" as a substring
      "return prompt.replace(/https?:\\/\\/[^\\s]+/g, ' ');",
      "const paths = slugs.map((s) => `frames/${s}/`);",
    ];
    for (const shape of mustPass) {
      const hit = FORBIDDEN_SOURCE.find((re) => re.test(shape));
      expect(hit, `${hit} false-positives on: ${shape}`).toBeUndefined();
    }
  });

  // Keep the closure SMALL, not merely clean. A large closure is how a Studio
  // dependency sneaks back in — the guard above only rejects today's known-bad
  // modules, so bounding growth is what makes it durable.
  it("the whole brain + host-glue closure stays small", () => {
    const all = new Set<string>();
    for (const e of [...BRAIN_ENTRYPOINTS, ...HOST_GLUE_ENTRYPOINTS]) {
      for (const f of closureOf(e).keys()) all.add(path.relative(SERVER_DIR, f));
    }
    // brain: turnRouting + provenance + turnConstraints + turnDirectives
    //        + frameSlug + hiFiIntent + scopedEdit
    // glue:  figmaNodeUrl + generationIntent + src/lib/figmaUrl
    //
    // THE TENTH MODULE, AND THE TEST DID ITS JOB AGAIN. `hiFiIntent.ts` is
    // `detectHiFiIntent` + its pattern array, extracted out of
    // `fidelityDirective.ts` as a zero-import leaf. Adding it failed this
    // assertion, which is the intended behaviour — growth is a decision someone
    // makes on purpose, in a diff.
    //
    // The cost is one leaf with zero imports; the return is two things the brain
    // genuinely needs. (a) `detectFreshImportIntent` uses it to keep a STATED
    // faithful-copy ask on the deterministic importer even when provenance can see
    // the node — hard constraint 4. (b) A foreign host must be able to compute
    // `shouldSuppressWholeFrame`'s `ctx.explicitHiFi`; before this it could not,
    // because the function lived only in `fidelityDirective.ts`, which is not on
    // this list. A host that guessed `false` silently got different routing from
    // Studio on the same prompt. Its 250 lines of `figmanage`-naming directive TEXT
    // stayed put and is still off the list.
    //
    // THE ELEVENTH MODULE is `resolveTurn.ts`, layer 4's seam, and it grew this
    // list on purpose — this assertion failing is what forced the decision to be
    // written down rather than absorbed. It costs one module whose only non-relative
    // import is `zod` (already a runtime dependency, and a schema validator with no
    // host coupling); it buys the ONE capability the deterministic layers provably
    // cannot supply, on prompts that provably need it (corpus #25 and #32, whose
    // prose used to be discarded by an engine with no LLM). The subprocess that
    // answers the question in Studio is an ADAPTER off this list.
    expect([...all].sort()).toEqual([
      "server/figma/figmaNodeUrl.ts",
      "server/figma/frameSlug.ts",
      "server/figma/generationIntent.ts",
      "server/figma/hiFiIntent.ts",
      "server/figma/provenance.ts",
      "server/figma/resolveTurn.ts",
      "server/figma/turnConstraints.ts",
      "server/figma/turnDirectives.ts",
      "server/figma/turnRouting.ts",
      "src/lib/figmaUrl.ts",
      "src/lib/scopedEdit.ts",
    ]);
  });

  // THE SEAM, END TO END, with NOTHING but the 8 modules above. This is the
  // Claude-Code host's whole implementation — if it needs a ninth module or a
  // Studio path, the seam is wrong and this test says so in one place rather than
  // leaving a future host to discover it.
  it("a foreign host can derive every input and get the fix, using only those modules", async () => {
    const { parseFigmaUrl } = await import("../../../server/figma/figmaNodeUrl");
    const url =
      "https://www.figma.com/design/ssUerkBL5uOm7tNyHoZVtc/Onboarding-3.0?node-id=5678-118877&t=2Dpcget8xJwUoFhQ-11";
    const parsed = parseFigmaUrl(url);
    expect(parsed).toEqual({ fileId: "ssUerkBL5uOm7tNyHoZVtc", nodeId: "5678:118877" });

    // Corpus #1 with the host handing over one file it already had in context.
    const plan = await planFigmaTurn(inputsFor(P(1)), {
      readFrames: async () => [
        {
          slug: "01-figma-5678-118876",
          source: '<div data-figma-id="5678:118877"/>',
          fileKey: "ssUerkBL5uOm7tNyHoZVtc",
        },
      ],
    });
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("provenance");
    expect(plan.targetFrame).toBe("01-figma-5678-118876");

    // AND IT CAN ACT ON THE PLAN. A correct plan with no way to turn it into words
    // the model reads is the .dmg-only fix this branch exists to avoid: before
    // turnDirectives.ts, this next line was only possible inside chat.ts.
    const { buildTurnDirectives } = await import("../../../server/figma/turnDirectives");
    const directives = buildTurnDirectives(plan);
    expect(directives.length).toBe(1);
    expect(directives[0]).toContain("01-figma-5678-118876");
  });

  // ── LAYER 4: THE SEAM MUST BE USABLE WITHOUT THE STUDIO ADAPTER ───────────────
  //
  // This is the brief's own acceptance test for the seam, and it is STRUCTURAL
  // rather than behavioural on purpose: a nested `claude --print` would work fine
  // in Studio's test suite and be dead on arrival in Cursor, which is precisely the
  // `import-hook-dead-in-dmg` shape one level up. So we assert the module GRAPH.
  it("the seam does not reach the CLI adapter, child_process, paths, or claudeBin", () => {
    const closure = closureOf("server/figma/resolveTurn.ts");
    const rels = [...closure.keys()].map((f) => path.relative(SERVER_DIR, f));
    for (const forbidden of [
      "server/figma/adapters/studioCliResolver.ts",
      "server/claudeBin.ts",
      "server/paths.ts",
      "server/figmaCli.ts",
    ]) {
      expect(rels, `resolveTurn.ts must not reach ${forbidden}`).not.toContain(forbidden);
    }
    // And no source-level coupling either — the guard's own needles, applied to the
    // seam's whole closure.
    for (const [file] of closure) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));
      for (const re of FORBIDDEN_SOURCE) {
        expect(re.test(src), `${path.relative(SERVER_DIR, file)} matches ${re}`).toBe(false);
      }
    }
  });

  // …and the ROUTING LAYER must not reach the adapter either. The cascade is what a
  // foreign host imports, so if `turnRouting.ts` pulled the adapter in for a default,
  // every host would pay for a subprocess it can never run. The adapter is reached
  // ONLY from Studio's middleware, which is not brain.
  it("the routing layer does not reach the CLI adapter", () => {
    const rels = [...closureOf("server/figma/turnRouting.ts").keys()].map((f) =>
      path.relative(SERVER_DIR, f),
    );
    expect(rels).not.toContain("server/figma/adapters/studioCliResolver.ts");
  });

  // THE SELF-TEST FOR THE TWO ASSERTIONS ABOVE — a guard that cannot fail is worse
  // than no guard, and "this module does not import that one" is exactly the shape
  // that silently becomes vacuous (a renamed file, a moved adapter). So prove the
  // adapter IS dirty: it must reach claudeBin and contain a forbidden source shape.
  // If this stops holding, the adapter has stopped being a subprocess adapter and
  // the two assertions above are measuring nothing.
  it("the adapter really is dirty (self-test for the separation assertions)", () => {
    const rels = [...closureOf("server/figma/adapters/studioCliResolver.ts").keys()].map((f) =>
      path.relative(SERVER_DIR, f),
    );
    expect(rels).toContain("server/claudeBin.ts");
    const dirty = codeOnly(
      fs.readFileSync(
        path.resolve(SERVER_DIR, "server/figma/adapters/studioCliResolver.ts"),
        "utf8",
      ),
    );
    expect(FORBIDDEN_SOURCE.some((re) => re.test(dirty))).toBe(true);
  });

  // A HEADLESS HOST GETS THE L4 FIX WITH NO SUBPROCESS ANYWHERE. Corpus #25 carries
  // real prose the deterministic layers cannot fix, and before layer 4 it reached an
  // engine with no LLM that discarded every word. Here an INLINE resolver — the
  // Claude-Code shape, answering from the turn it is already inside — takes it off
  // the importer and the directive text follows, all from the brain modules above.
  it("an inline resolver fixes #25 in a foreign host, with no adapter and no reader", async () => {
    const { buildTurnDirectives } = await import("../../../server/figma/turnDirectives");
    const plan = await planFigmaTurn(inputsFor(P(25)), {
      // What a Claude Code host does: it is already in a model turn, so it answers.
      resolveTurn: async () => ({ kind: "edit", constraints: ["single-frame"] }),
    });
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("resolver");
    const directives = buildTurnDirectives(plan);
    expect(directives.length).toBe(1);
    expect(directives[0]).toContain("<single_frame_constraint>");
  });

  // #30 IS THE LIVE FAILURE, so prove the whole chain lands in a foreign host with
  // NOTHING injected: no reader, no Studio path, no middleware. This is the
  // assertion that makes "the fix travels to every host" a checked claim rather
  // than an intention.
  it("#30's constraint becomes a real directive with zero host capability", async () => {
    const { buildTurnDirectives } = await import("../../../server/figma/turnDirectives");
    const directives = buildTurnDirectives(await planFigmaTurn(inputsFor(P(30))));
    expect(directives.length).toBe(1);
    expect(directives[0]).toContain("<single_frame_constraint>");
    expect(directives[0]).toContain("Do NOT create a new frame directory");
  });
});
