/**
 * Build the scoped instruction handed to the generator subprocess when a
 * designer saves a picked element as a reusable component. Mirrors the
 * discipline of the scoped-edit preamble (PromptInput.buildTargetPreamble):
 * read the file, the line:column identifies the element, act narrowly.
 */
export function buildExtractPrompt(args: {
  name: string; description: string; frameSlug: string; line: number; column: number; outPath: string;
}): string {
  const rel = `frames/${args.frameSlug}/index.tsx`;
  return [
    `Extract a reusable component from an existing frame.`,
    ``,
    `Source: ${rel}:${args.line}:${args.column}`,
    `Read ${rel} first — do not work from memory. The line:column above identifies`,
    `the root element of the sub-tree to extract. Extract ONLY that element and its`,
    `children.`,
    ``,
    `Write a new file at ${args.outPath} that exports a single`,
    `component named ${args.name}. Requirements:`,
    `- Start with a JSDoc header comment whose first line is: ${args.description}`,
    `- Compose primitives from "arcade/components" and existing composites from`,
    `  "arcade-prototypes" — never re-implement a primitive, never hardcode hex/rgb`,
    `  (use --fg-*/--surface-*/--stroke-*/--bg-* tokens).`,
    `- Lift hardcoded strings, counts, and repeated data into a props type named`,
    `  ${args.name}Props. EVERY prop MUST be optional (\`?\`) AND have a default`,
    `  value equal to what the element showed in the original frame (e.g. the`,
    `  real title text, the real label). This is REQUIRED: \`<${args.name} />\` with`,
    `  NO props must render exactly like the original — fully populated, never`,
    `  blank. A component that renders empty without props is wrong.`,
    `- Do not import anything from the original frame; the file must stand alone.`,
    `- Export it BOTH ways: \`export function ${args.name}(...)\` (named) AND end the`,
    `  file with \`export default ${args.name};\`. Both are required — the named export`,
    `  is how other prototypes import it, the default export is how it renders standalone.`,
    ``,
    `Write ONLY that one file. A reply without a Write tool call is a failed turn.`,
  ].join("\n");
}
