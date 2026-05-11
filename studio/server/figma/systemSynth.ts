import { spawn as spawnChild } from "node:child_process";
import { z } from "zod";
import type { SynthesizedSections } from "./types";
import type { SystemSources } from "./systemSources";
import { resolveClaudeBin } from "../claudeBin";

export interface SynthSpawnResult { text: string; exitCode: number | null }
export interface SynthDeps {
  spawn?: (prompt: string, imagePaths: string[]) => Promise<SynthSpawnResult>;
  model?: string;
  timeoutMs?: number;
}

const TokenEntrySchema = z.object({
  name: z.string(),
  value: z.string(),
  role: z.string(),
});

const TokenSectionSchema = z.object({
  entries: z.array(TokenEntrySchema),
  warnings: z.array(z.string()).default([]),
});

const SectionsSchema = z.object({
  identity: z.string(),
  colors: TokenSectionSchema,
  typography: TokenSectionSchema,
  spacing: z.object({ scale: z.array(z.number()), notes: z.string().optional() }),
  radii: z.object({ scale: z.array(z.number()), notes: z.string().optional() }),
  shadows: z.object({ items: z.array(z.object({ name: z.string(), css: z.string() })) }),
  components: z.array(z.string()),
  warnings: z.array(z.string()).default([]),
});

const COLOR_ROLES = new Set(["background", "surface", "text", "accent", "status", "other"]);
const TYPO_ROLES = new Set(["heading", "body", "caption", "code", "other"]);

export async function synthesizeSystem(
  sources: SystemSources,
  deps: SynthDeps = {},
): Promise<SynthesizedSections> {
  const spawner = deps.spawn ?? defaultSpawner(deps.model, deps.timeoutMs ?? 60_000);
  const prompt = buildPrompt(sources);
  const images = sources.sampleFrames.map((f) => f.pngPath);
  const reply = await spawner(prompt, images);
  if (reply.exitCode !== 0) {
    throw new Error(`synthesizer exited ${reply.exitCode}`);
  }

  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(reply.text)); }
  catch { throw new Error("synthesizer reply parse failed"); }

  const check = SectionsSchema.safeParse(parsed);
  if (!check.success) {
    const issue = check.error.issues[0];
    throw new Error(`synthesizer schema mismatch: ${issue.path.join(".")} — ${issue.message}`);
  }

  return postProcess(check.data, sources);
}

function postProcess(
  parsed: z.infer<typeof SectionsSchema>,
  sources: SystemSources,
): SynthesizedSections {
  const warnings = [...parsed.warnings];

  const allowedColorValues = new Set([
    ...sources.styles.paint.map((p) => p.hex),
    ...sources.variables.color.map((v) => v.hex),
  ].filter(Boolean));

  const colors = {
    entries: parsed.colors.entries.flatMap((e) => {
      if (!COLOR_ROLES.has(e.role)) {
        warnings.push(`dropped color "${e.name}" with unknown role "${e.role}"`);
        return [];
      }
      if (allowedColorValues.size > 0 && !allowedColorValues.has(e.value)) {
        warnings.push(`dropped color "${e.name}" with unsourced value "${e.value}"`);
        return [];
      }
      return [{ name: e.name, value: e.value, role: e.role as any }];
    }),
    warnings: parsed.colors.warnings,
  };

  const typography = {
    entries: parsed.typography.entries.flatMap((e) => {
      if (!TYPO_ROLES.has(e.role)) {
        warnings.push(`dropped typo "${e.name}" with unknown role "${e.role}"`);
        return [];
      }
      return [{ name: e.name, value: e.value, role: e.role as any }];
    }),
    warnings: parsed.typography.warnings,
  };

  const components = [...new Set(parsed.components.filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    identity: parsed.identity.trim(),
    colors,
    typography,
    spacing: { scale: uniqueSortedNumbers(parsed.spacing.scale), notes: parsed.spacing.notes },
    radii: { scale: uniqueSortedNumbers(parsed.radii.scale), notes: parsed.radii.notes },
    shadows: parsed.shadows,
    components,
    warnings,
  };
}

function uniqueSortedNumbers(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const stripped = fence ? fence[1] : text;
  const m = stripped.match(/\{[\s\S]*\}/);
  return m ? m[0] : stripped.trim();
}

function buildPrompt(s: SystemSources): string {
  const digest = {
    paint: s.styles.paint.map((p) => ({ name: p.name, hex: p.hex })),
    text: s.styles.text.map((t) => ({
      name: t.name, family: t.family, size: t.size, weight: t.weight,
      lineHeight: t.lineHeight, letterSpacing: t.letterSpacing,
    })),
    effect: s.styles.effect.map((e) => ({ name: e.name, css: e.css })),
    variables: {
      color: s.variables.color.map((v) => ({ name: v.name, hex: v.hex })),
      number: s.variables.number.map((v) => ({ name: v.name, value: v.value })),
    },
    components: s.components.map((c) => c.name),
  };
  return [
    "You are analyzing a Figma design system. Output ONE JSON object matching the schema below.",
    "No prose, no markdown fences. Just the JSON.",
    "",
    "Rules:",
    "- `identity` is 50-80 words, describing visual personality (density, ornamentation, temperature, formality). Grounded in the sample frames if provided; concrete not generic.",
    "- For each color entry, pick role from: background, surface, text, accent, status, other. The `value` MUST be one of the hex values I passed you verbatim — do not alter hexes.",
    "- For each typography entry, pick role from: heading, body, caption, code, other. Encode `value` as \"<family> <size>/<lineHeight> <weight>\" (e.g. \"Inter 14/20 400\").",
    "- `spacing.scale` and `radii.scale` are sorted ascending, unique numbers observed across the input.",
    "- `components` is the list of component names, sorted alphabetically, deduped.",
    "",
    "Schema:",
    '{ identity: string, colors: { entries: [{name, value, role}], warnings: string[] }, typography: { entries: [{name, value, role}], warnings: string[] }, spacing: { scale: number[] }, radii: { scale: number[] }, shadows: { items: [{name, css}] }, components: string[], warnings: string[] }',
    "",
    "Input digest:",
    "```json",
    JSON.stringify(digest),
    "```",
  ].join("\n");
}

function defaultSpawner(modelOpt: string | undefined, timeoutMs: number) {
  return (prompt: string, imagePaths: string[]) =>
    new Promise<SynthSpawnResult>((resolve) => {
      const model = modelOpt
        ?? process.env.ARCADE_STUDIO_SYNTH_MODEL?.trim()
        ?? "sonnet";
      const bin = resolveClaudeBin();
      const args = ["--bare", "--model", model, "--print"];
      for (const p of imagePaths) args.push("--attach", p);
      args.push(prompt);
      const proc = spawnChild(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      proc.stdout.on("data", (c) => { text += c.toString(); });
      proc.stderr.on("data", () => {});
      const timer = setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} }, timeoutMs);
      proc.on("close", (exitCode) => { clearTimeout(timer); resolve({ text, exitCode }); });
      proc.on("error", () => resolve({ text: "", exitCode: -1 }));
    });
}
