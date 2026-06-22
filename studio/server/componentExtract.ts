/**
 * Build the scoped instruction handed to the generator subprocess when a
 * designer saves a picked element as a reusable component. Mirrors the
 * discipline of the scoped-edit preamble (PromptInput.buildTargetPreamble):
 * read the file, the line:column identifies the element, act narrowly.
 */
export function buildExtractPrompt(args: {
  name: string; description: string; frameSlug: string; line: number; column: number;
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
    `Write a new file at user-kit/composites/${args.name}.tsx that exports a single`,
    `component named ${args.name}. Requirements:`,
    `- Start with a JSDoc header comment whose first line is: ${args.description}`,
    `- Compose primitives from "arcade/components" and existing composites from`,
    `  "arcade-prototypes" — never re-implement a primitive, never hardcode hex/rgb`,
    `  (use --fg-*/--surface-*/--stroke-*/--bg-* tokens).`,
    `- Lift hardcoded strings, counts, and repeated data into a props type named`,
    `  ${args.name}Props, with sensible defaults so <${args.name} /> renders standalone.`,
    `- Do not import anything from the original frame; the file must stand alone.`,
    ``,
    `Write ONLY that one file. A reply without a Write tool call is a failed turn.`,
  ].join("\n");
}
