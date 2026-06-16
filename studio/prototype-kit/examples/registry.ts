import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE_OPT_OUT } from "./OPT_OUT";

const EXAMPLES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Names (sans .tsx) of all authored example files in this directory. */
export function getExampleNames(): string[] {
  return fs
    .readdirSync(EXAMPLES_DIR)
    .filter((f) => /^[A-Z][A-Za-z0-9]*\.tsx$/.test(f))
    .map((f) => f.replace(/\.tsx$/, ""))
    .sort();
}

export { EXAMPLE_OPT_OUT };
