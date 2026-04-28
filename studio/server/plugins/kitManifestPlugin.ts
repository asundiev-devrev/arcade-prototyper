/**
 * kitManifestPlugin — regenerate `prototype-kit/KIT-MANIFEST.md` on studio
 * boot and whenever a kit file changes.
 *
 * The manifest is what the generator agent Reads before touching any
 * individual composite/template source. Keeping it fresh at dev time means
 * a designer editing a composite in their own checkout sees the updated
 * manifest on the next turn, without rerunning any build step.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { writeManifest } from "../kitManifest";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// studio/server/plugins/ → studio/prototype-kit/
const KIT_ROOT = path.resolve(MODULE_DIR, "..", "..", "prototype-kit");

function isKitSourceFile(file: string): boolean {
  return (
    file.startsWith(KIT_ROOT) &&
    (file.endsWith(".tsx") || file.endsWith(".ts")) &&
    !file.endsWith("KIT-MANIFEST.md") &&
    !file.endsWith("index.ts")
  );
}

export function kitManifestPlugin(): Plugin {
  let regenerating = false;
  const regenerate = async (reason: string) => {
    if (regenerating) return;
    regenerating = true;
    try {
      await writeManifest(KIT_ROOT);
      console.log(`[studio] kit manifest regenerated (${reason})`);
    } catch (err) {
      console.warn("[studio] kit manifest regeneration failed:", err);
    } finally {
      regenerating = false;
    }
  };

  return {
    name: "arcade-studio-kit-manifest",
    async buildStart() {
      await regenerate("boot");
    },
    configureServer(server) {
      server.watcher.on("change", (file) => {
        if (isKitSourceFile(file)) void regenerate(`change: ${path.basename(file)}`);
      });
      server.watcher.on("add", (file) => {
        if (isKitSourceFile(file)) void regenerate(`add: ${path.basename(file)}`);
      });
      server.watcher.on("unlink", (file) => {
        if (isKitSourceFile(file)) void regenerate(`remove: ${path.basename(file)}`);
      });
    },
  };
}
