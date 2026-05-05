// studio/src/lift/buildManifest.ts
//
// Pure assembly of a Manifest. Takes frame source text + metadata; returns
// a fully-populated Manifest. No I/O. The plugin and middleware call this
// after reading files from disk.

import { parseImports } from "./parseImports";
import { detectShape } from "./detectShape";
import { scaffoldingFor } from "./scaffolding";
import { ALL_MAPPINGS, findMapping } from "./mappings";
import type { Manifest, MappingEntry } from "./types";

export interface BuildManifestInput {
  projectSlug: string;
  frameSlug: string;
  frameAbsPath: string;
  frameSource: string;
  intentSummary: string;
  figmaUrl?: string;
  screenshotUrl?: string;
}

export function buildManifest(input: BuildManifestInput): Manifest {
  const imports = parseImports(input.frameSource);
  const shape = detectShape(imports);
  const scaffolding = scaffoldingFor(shape);

  const mappings: MappingEntry[] = [];
  const unmapped: Array<{ source: string; name: string }> = [];
  for (const imp of imports) {
    for (const name of imp.names) {
      const entry = findMapping(imp.source, name);
      if (entry) mappings.push(entry);
      else unmapped.push({ source: imp.source, name });
    }
  }

  return {
    projectSlug: input.projectSlug,
    frameSlug: input.frameSlug,
    frameAbsPath: input.frameAbsPath,
    intentSummary: input.intentSummary,
    imports,
    mappings,
    unmapped,
    shape,
    scaffolding,
    figmaUrl: input.figmaUrl,
    screenshotUrl: input.screenshotUrl,
    schemaVersion: 1,
  };
}

// Re-export so consumers can do `import { ALL_MAPPINGS } from ".../buildManifest"` if convenient.
export { ALL_MAPPINGS };
