#!/usr/bin/env node
/**
 * `plan-turn` — the brain's routing decision, as a CLI, for hosts that are not
 * Studio.
 *
 * WHY THIS EXISTS
 * The routing brain (planFigmaTurn + buildTurnDirectives) is deliberately
 * host-agnostic TypeScript, but its only caller is Studio's Vite middleware. The
 * designers do not use the Studio desktop app — they work in their own Cursor /
 * Claude Code. So a fix that lives only behind `chat.ts` ships to the one host
 * nobody uses.
 *
 * A Claude Code / Cursor session cannot `import` TypeScript out of this repo, but
 * it CAN run a command and read stdout — the `arcade-prototyper` skill already
 * shells out to `figmanage` for every Figma read. This is the same idiom, so the
 * skill can consult the brain instead of restating its rules in prose (which would
 * be a second copy of the logic, free to drift from the tested one).
 *
 * CONTRACT
 *   node planTurn.mjs --prompt "<the designer's message>" [--frames <dir>] [--json]
 *
 * Prints, by default, a short human/agent-readable brief: what kind of turn this
 * is, which frame to edit if we know it, and the directives to obey. `--json`
 * prints the raw plan for programmatic use.
 *
 * Exit codes: 0 = a plan was produced (including "no Figma URL, nothing to do").
 * 2 = bad usage. 1 = an internal failure. A non-zero exit must never be read as
 * "do nothing" — see the skill guidance: on failure the host falls back to its
 * normal behaviour, exactly as a host that supplies no capabilities at all does.
 *
 * WHAT IT DOES NOT DO
 * No model call, no Figma call, no network. It answers only from the prompt text
 * and (optionally) the frame sources on disk. Layer 4 (the host-answered resolver)
 * is deliberately NOT wired here: a CLI has no model to ask, and an inline host
 * answers that question itself. Absent resolver = today's behaviour, never an
 * error.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.resolve(HERE, "../../..");

/**
 * Load the brain's TypeScript through esbuild.
 *
 * The alternative — publishing a compiled dist — is the right end state, but it
 * needs a build step in the release path and this has to be runnable from a
 * checkout today. esbuild is already a dependency of this repo (the frame sidecar
 * uses it), so no new install.
 *
 * Bundling from `turnRouting.ts` also means the import graph that actually gets
 * pulled in is the brain's own, which is exactly what the transitive-closure guard
 * in __tests__/server/figma/headlessRouting.test.ts pins. If someone re-couples
 * the brain to Studio, this CLI is how they find out loudly.
 */
async function loadBrain() {
  const entry = path.join(STUDIO_ROOT, "server/figma/cli/brainEntry.ts");
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    absWorkingDir: STUDIO_ROOT,
    logLevel: "silent",
  });
  const code = out.outputFiles[0].text;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

/**
 * Read every frame's entry source from a frames directory.
 *
 * This is the host's HALF of layer 2 (provenance) — the brain never touches the
 * filesystem itself, it iterates what a reader hands it. Studio's binding lives in
 * server/figma/adapters/studioFrameReader.ts and reads its projects dir; this one
 * reads whatever directory the caller names, so it works in a boilerplate repo, a
 * user's own project, or nothing at all.
 *
 * A missing/unreadable dir is NOT an error: provenance simply has nothing to match
 * against, and the cascade falls through to its other layers. That is the same
 * degradation a host that supplies no reader gets.
 */
function makeDirFrameReader(framesDir) {
  return async () => {
    let entries;
    try {
      entries = await readdir(framesDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      // Try the conventional entry names, in order. A frame with none of them
      // contributes nothing rather than failing the whole read.
      for (const name of ["index.tsx", "index.jsx", "index.ts", "index.js"]) {
        try {
          const source = await readFile(path.join(framesDir, e.name, name), "utf-8");
          out.push({ slug: e.name, source });
          break;
        } catch {
          /* try the next candidate */
        }
      }
    }
    return out;
  };
}

function parseArgs(argv) {
  const args = { prompt: null, framesDir: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prompt" || a === "-p") args.prompt = argv[++i] ?? null;
    else if (a === "--frames" || a === "-f") args.framesDir = argv[++i] ?? null;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!args.prompt) args.prompt = a; // bare first positional = the prompt
  }
  return args;
}

const USAGE = `plan-turn — decide what a Figma-referencing prompt is asking for

  node planTurn.mjs --prompt "<message>" [--frames <dir>] [--json]

  --prompt, -p   The designer's message, verbatim (quote it).
  --frames, -f   Directory of existing frames (each a subdir with index.tsx).
                 Omit it and provenance is skipped — the brain then answers from
                 the prompt text alone, which is still useful.
  --json         Print the raw plan instead of the brief.

Answers from the prompt and local files only. No model call, no network.`;

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(USAGE); return 0; }
  if (!args.prompt || !args.prompt.trim()) {
    console.error("plan-turn: --prompt is required\n\n" + USAGE);
    return 2;
  }

  const brain = await loadBrain();
  const {
    planFigmaTurn,
    buildTurnDirectives,
    extractFigmaUrls,
    parseFigmaUrl,
    detectInteractionIntent,
    shouldGenerateFromFigma,
  } = brain;

  const prompt = args.prompt;
  const urls = extractFigmaUrls(prompt);
  const parsed = urls.map((u) => parseFigmaUrl(u)).filter(Boolean);
  // parseFigmaUrl calls it `fileId`; provenance's NodeRef calls it `fileKey`.
  // Same value — the translation happens here rather than widening either type.
  const nodeIds = parsed.map((p) => ({ nodeId: p.nodeId, fileKey: p.fileId }));

  const plan = await planFigmaTurn(
    {
      hasFigmaNode: parsed.length > 0,
      wantsGeneration: shouldGenerateFromFigma(prompt),
      hasInteractionIntent: detectInteractionIntent(prompt),
      figmaUrlCount: urls.length,
      prompt,
      nodeIds,
    },
    args.framesDir ? { readFrames: makeDirFrameReader(args.framesDir) } : {},
  );

  const directives = buildTurnDirectives(plan);

  if (args.json) {
    console.log(JSON.stringify({ plan, directives }, null, 2));
    return 0;
  }

  // The default output is written to be READ BY AN AGENT mid-turn, so it leads
  // with the instruction rather than the diagnosis.
  const lines = [];
  if (plan.kind === "kit-emit") {
    lines.push("ACTION: import this Figma node faithfully as a NEW frame.");
    lines.push("The prompt carries no instruction the importer would have to drop.");
  } else if (plan.kind === "wire") {
    lines.push("ACTION: import the screen, then wire the named interaction into it.");
    lines.push("Do not create a separate frame for the second design.");
  } else if (plan.targetFrame) {
    lines.push(`ACTION: EDIT the existing frame \`${plan.targetFrame}\`.`);
    lines.push("This is not a new screen. Do NOT create another frame — the node in");
    lines.push("this prompt was already imported into that frame.");
  } else if (plan.frameCandidates?.length) {
    lines.push("ACTION: EDIT an existing frame — but which one is ambiguous.");
    lines.push(`Candidates: ${plan.frameCandidates.join(", ")}`);
    lines.push("Ask which one rather than guessing, or inspect them first.");
  } else if (plan.decidedBy === "no-node") {
    lines.push("No Figma node in this prompt — routing has no opinion. Proceed normally.");
  } else {
    lines.push("ACTION: build/edit with the design as reference.");
  }

  if (plan.constraints.length) {
    lines.push("", `CONSTRAINTS THE DESIGNER STATED: ${plan.constraints.join(", ")}`);
  }
  if (directives.length) {
    lines.push("", "OBEY THESE, VERBATIM:", ...directives);
  }
  lines.push("", `(decided by: ${plan.decidedBy})`);
  console.log(lines.join("\n"));
  return 0;
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    // A failure here must not silently change behaviour: say so on stderr and exit
    // non-zero so the caller falls back to its normal path.
    console.error(`plan-turn failed: ${err?.message ?? String(err)}`);
    process.exit(1);
  },
);
