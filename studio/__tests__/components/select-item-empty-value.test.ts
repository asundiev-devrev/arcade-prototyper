import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { globSync } from "node:fs";

/**
 * Radix Select (used by arcade-gen's Select) reserves the empty string as
 * its internal "no selection" sentinel. Passing `value=""` to `Select.Item`
 * throws at mount time with:
 *
 *   A <Select.Item /> must have a value prop that is not an empty string.
 *
 * Because the throw happens inside the modal body, the whole modal blanks
 * out — the user just sees an empty dialog with no clue what's wrong. This
 * cost us a beta-tester debug cycle.
 *
 * This static test scans every component file for Select.Item and fails
 * if any uses `value=""` or a literal empty-string template. Not airtight
 * (dynamic values still compile), but catches the 90% case where someone
 * writes <Select.Item value=""> directly, which was the actual regression.
 */

const COMPONENT_DIRS = [
  path.resolve(__dirname, "..", "..", "src"),
];

function walk(dir: string): string[] {
  return globSync(path.join(dir, "**", "*.{ts,tsx}"), { nodir: true } as any) as string[];
}

describe("Select.Item must never have value=\"\"", () => {
  it("no .tsx file passes an empty-string literal to Select.Item's value prop", () => {
    const offenders: Array<{ file: string; line: number; snippet: string }> = [];
    for (const dir of COMPONENT_DIRS) {
      for (const file of walk(dir)) {
        const text = readFileSync(file, "utf-8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match `<Select.Item ... value="" ...>` or `value={""}` or `value={''}` on
          // the same line. Leave multi-line JSX as a future concern — the common
          // mistake is on one line.
          if (/<Select\.Item\b[^>]*\bvalue\s*=\s*(?:""|''|\{\s*(?:""|'')\s*\})/.test(line)) {
            offenders.push({ file, line: i + 1, snippet: line.trim() });
          }
        }
      }
    }
    expect(
      offenders,
      "Found Select.Item with empty-string value (Radix will throw and blank the modal):\n" +
        offenders.map((o) => `  ${o.file}:${o.line}  ${o.snippet}`).join("\n"),
    ).toEqual([]);
  });
});
