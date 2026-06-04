import fs from "node:fs/promises";
import path from "node:path";

function rulesStub(scope: string): string {
  return `<!-- RULES.md — your standing instructions for ${scope}. Hand-written.
     The generator reads this every turn but never edits it. -->
`;
}

function learnedStub(scope: string): string {
  return `<!-- LEARNED.md — facts the generator remembers about ${scope}.
     Auto-appended during generation; safe to edit or prune by hand. -->
`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Idempotently seed RULES.md + LEARNED.md stubs in `dir`. Creates `dir` if
 * needed. NEVER overwrites a file that already exists — edited content (by
 * the user in RULES.md, or appended by the agent in LEARNED.md) is preserved.
 * `scope` is a human label woven into the stub header ("global", "this
 * project", …).
 */
export async function ensureMemoryStubs(dir: string, scope: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const rules = path.join(dir, "RULES.md");
  const learned = path.join(dir, "LEARNED.md");
  if (!(await fileExists(rules))) await fs.writeFile(rules, rulesStub(scope));
  if (!(await fileExists(learned))) await fs.writeFile(learned, learnedStub(scope));
}
