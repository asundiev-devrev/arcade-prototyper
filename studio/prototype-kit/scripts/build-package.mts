// Build the publishable @devrev-private/arcade-prototype-kit package.
//
// 1. Compile composites/templates/barrel .tsx -> dist/ (.js + .d.ts).
// 2. Generate KIT-MANIFEST.md from source and copy it into dist/ so the
//    `./manifest` export resolves. The sidecar serves this file as the
//    agent's API reference.
//
// Run from the kit root via `pnpm run build`.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifestEntries, renderManifestMarkdown } from "../../server/kitManifest.ts";

const KIT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(path.dirname(KIT_ROOT));
const DIST = path.join(KIT_ROOT, "dist");

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });

  // tsc emit — resolved from the repo root's typescript devDependency
  // (the kit has no local node_modules; it shares the root install).
  execFileSync("pnpm", ["exec", "tsc", "-p", path.join(KIT_ROOT, "tsconfig.build.json")], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });

  // Manifest is generated from source so it never drifts from the kit.
  const entries = await buildManifestEntries(KIT_ROOT);
  const md = renderManifestMarkdown(entries);
  await fs.writeFile(path.join(DIST, "KIT-MANIFEST.md"), md);

  // eslint-disable-next-line no-console
  console.log(`[build-package] dist ready — ${entries.length} kit entries, manifest written.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
