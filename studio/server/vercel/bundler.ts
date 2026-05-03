import { build, type Plugin } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile as tailwindCompile } from "@tailwindcss/node";
import { Scanner as TailwindScanner } from "@tailwindcss/oxide";
import { studioRoot } from "../paths";
import { generateDevRevStubs } from "./stubDevRev";

// The DevRev font CDN Referer-whitelists its origins. Browsers loading a
// Vercel-deployed frame hit 403 because `*.vercel.app` isn't whitelisted, so
// @xorkavi/arcade-gen's @font-face URLs never resolve and headings render in
// system sans-serif. Node's fetch omits Referer by default, so we can pull
// the fonts server-side at bundle time, base64-inline them into the CSS, and
// avoid any runtime dependency on the CDN.
const FONT_CDN = "https://files.dev.devrev-eng.ai/fonts";
const FONT_FAMILIES: Array<{
  name: string;
  family: string;
  weight: string;
}> = [
  { name: "ChipDispVar.woff2", family: "Chip Display Variable", weight: "100 900" },
  { name: "ChipTextVar.woff2", family: "Chip Text Variable", weight: "100 900" },
  { name: "ChipMono-Regular.woff2", family: "Chip Mono", weight: "400" },
  { name: "ChipMono-Medium.woff2", family: "Chip Mono", weight: "500" },
];

// Compile Tailwind v4 for a specific frame directory.
//
// Why we need this: studio's dev server runs @tailwindcss/vite which scans
// studio/src, studio/prototype-kit AND the generated frame's source for
// utility classes and generates CSS for every one it finds. The Vercel
// bundler historically only shipped arcade-gen's pre-compiled styles.css —
// the subset of classes arcade-gen itself happened to use. Any class in the
// generated frame that arcade-gen doesn't also use (pt-12, text-title-3,
// arbitrary values like max-w-[832px], responsive variants, etc.) silently
// didn't exist on Vercel, so spacing, typography and layout diverged from
// what the user saw in studio.
//
// Fix: mirror the studio pipeline. Read the same tailwind.css entry, append
// an @source for the frame directory + prototype-kit so frame-scoped
// classes get scanned, compile with @tailwindcss/node, and produce the
// resulting CSS. We append to the esbuild CSS output rather than replacing
// it because arcade-gen's styles.css also carries tokens, font-face rules,
// and component-specific CSS we still need.
async function buildFrameTailwindCss(framePath: string): Promise<string> {
  const tailwindEntry = path.join(STUDIO_SRC_STYLES, "tailwind.css");
  const baseCss = await fs.readFile(tailwindEntry, "utf-8");

  // Match studio's injectStudioSourcePlugin: point Tailwind at the frame's
  // own source files so every utility class it uses gets compiled in. We
  // also add prototype-kit here (even though the static @source already
  // covers it) because `base` for @tailwindcss/node is set to the frame
  // dir, not the repo — which changes how relative globs resolve.
  const extraSources = [
    `@source "${framePath.replace(/\\/g, "/")}/**/*.{ts,tsx}";`,
    `@source "${path.join(REPO_ROOT, "studio", "prototype-kit").replace(/\\/g, "/")}/**/*.{ts,tsx}";`,
  ].join("\n");
  const cssWithSources = baseCss + "\n" + extraSources + "\n";

  const compiler = await tailwindCompile(cssWithSources, {
    // `base` is where Tailwind resolves relative imports and relative
    // @source globs from. STUDIO_SRC_STYLES is what studio's vite pipeline
    // uses implicitly, so matching it keeps `@source "../../../studio/src/..."`
    // (in tailwind.css) resolving identically.
    base: STUDIO_SRC_STYLES,
    from: tailwindEntry,
    onDependency: () => {},
  });

  // Build the Scanner from the compiler's declared sources, same way the
  // official @tailwindcss/vite plugin does. The "root" source is the
  // implicit scan root; "sources" are the @source globs.
  const scannerSources =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: STUDIO_SRC_STYLES, pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }];
  const scanner = new TailwindScanner({
    sources: [...scannerSources, ...compiler.sources],
  });
  const candidates = scanner.scan();
  const ast = compiler.build(candidates);

  // compiler.build returns an AST; @tailwindcss/node doesn't directly
  // expose a stringifier. But the build function's return type is
  // actually a string at runtime — the type declaration is a lie. Cast.
  return ast as unknown as string;
}

async function buildInlineFontFaceCss(): Promise<string> {
  const blocks: string[] = [];
  for (const f of FONT_FAMILIES) {
    const res = await fetch(`${FONT_CDN}/${f.name}`);
    if (!res.ok) {
      // Soft-fail: skip the missing font, headings fall back to system stack.
      // Better than blowing up the whole deploy.
      console.warn(`[vercel] font fetch ${f.name} failed: ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    blocks.push(
      `@font-face{font-family:"${f.family}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${f.weight};font-display:swap}`,
    );
  }
  return blocks.join("\n");
}

// Resolve the arcade-prototyper repo root from this file's own location:
//   <repo>/studio/server/vercel/bundler.ts → two "../" lands at <repo>/studio/
//   server, three more lands at <repo>. This is where the repo's node_modules
//   actually lives, both in dev checkouts and inside the packaged .app bundle
//   (Contents/Resources/app/node_modules/).
const STUDIO_SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(STUDIO_SERVER_DIR, "..", "..", "..");
const REPO_NODE_MODULES = path.join(REPO_ROOT, "node_modules");
const STUDIO_SRC_STYLES = path.join(REPO_ROOT, "studio", "src", "styles");

function devrevStubPlugin(): Plugin {
  return {
    name: "arcade-studio-devrev-stub",
    setup(b) {
      b.onResolve({ filter: /(^|\/)shared\/devrev(\.ts|\.tsx|\.js)?$/ }, (args) => ({
        path: args.path,
        namespace: "devrev-stub",
      }));
      b.onLoad({ filter: /.*/, namespace: "devrev-stub" }, () => ({
        contents: generateDevRevStubs(),
        loader: "tsx",
      }));
    },
  };
}

// Mirror studio/vite.config.ts's path aliases for esbuild. Studio's generated
// frames import from `arcade` and `arcade/components` (readable aliases the
// agent is told to use in CLAUDE.md.tpl); `arcade-prototypes` maps to the
// prototype-kit tree. Vite resolves these at dev time; esbuild needs the same
// mapping explicitly or bundling fails with "Could not resolve 'arcade/...'".
//
// esbuild's built-in `alias` option rewrites the specifier BEFORE the
// resolution walk, so the result still passes through node_modules / nodePaths
// lookup naturally. That's cleaner than a plugin that tries to short-circuit
// the path.
//
// Keep this in sync with studio/vite.config.ts's `resolve.alias`.
const ARCADE_SHIM_PATH = path.join(REPO_ROOT, "studio", "prototype-kit", "arcade-components.tsx");
const ARCADE_ALIASES = {
  "arcade": ARCADE_SHIM_PATH,
  "arcade/components": ARCADE_SHIM_PATH,
  "arcade-prototypes": path.join(REPO_ROOT, "studio", "prototype-kit"),
} as const;

interface BuildContext {
  projectSlug: string;
  frameSlug: string;
  framePath: string;
  theme: "arcade" | "devrev-app";
  mode: "light" | "dark";
}

export async function buildFrameBundle(ctx: BuildContext): Promise<{
  html: string;
  js: string;
  css: string;
}> {
  const tempDir = path.join(studioRoot(), ".temp", `build-${ctx.projectSlug}-${ctx.frameSlug}`);
  await fs.mkdir(tempDir, { recursive: true });

  // arcade-gen-patches.css lives in the studio source tree, not in the
  // user-data directory. `studioRoot()` returns ~/Library/Application Support
  // /arcade-studio/ (where projects live), which does NOT contain src/. The
  // correct location is <repo>/studio/src/styles/. Both dev checkouts and
  // the packaged .app have this path under REPO_ROOT.
  const patchesCssPath = path.join(STUDIO_SRC_STYLES, "arcade-gen-patches.css").replace(/\\/g, "/");

  const entrypoint = `
import React from "react";
import ReactDOM from "react-dom/client";
import { DevRevThemeProvider } from "@xorkavi/arcade-gen";
import "@xorkavi/arcade-gen/styles.css";
import "${patchesCssPath}";
import Frame from "${ctx.framePath}/index.tsx";

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <DevRevThemeProvider mode="${ctx.mode}">
        <Frame />
      </DevRevThemeProvider>
    </React.StrictMode>
  );
}
`;

  const entrypointPath = path.join(tempDir, "entrypoint.tsx");
  await fs.writeFile(entrypointPath, entrypoint);

  try {
    const result = await build({
      entryPoints: [entrypointPath],
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      outdir: tempDir,
      write: false,
      loader: {
        ".tsx": "tsx",
        ".ts": "tsx",
        ".css": "css",
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".svg": "dataurl",
        ".woff": "dataurl",
        ".woff2": "dataurl",
      },
      external: [],
      jsx: "automatic",
      alias: { ...ARCADE_ALIASES },
      plugins: [devrevStubPlugin()],
      // The entrypoint lives under ~/Library/Application Support/arcade-studio/
      // .temp/ — far outside the repo. esbuild's default node_modules
      // resolution walks up from the entrypoint and never reaches the repo's
      // node_modules, so it fails with "Could not resolve 'react'". Both
      // `absWorkingDir` (so bare specifiers resolve against the repo) and
      // `nodePaths` (so node_modules lookups fall back to the repo's) are
      // needed — the former handles the resolveDir, the latter is the
      // belt-and-suspenders for transitive dependencies.
      absWorkingDir: REPO_ROOT,
      nodePaths: [REPO_NODE_MODULES],
    });

    const jsOutput = result.outputFiles.find(f => f.path.endsWith(".js"));
    const cssOutput = result.outputFiles.find(f => f.path.endsWith(".css"));

    const js = jsOutput?.text || "";
    // Three things get appended to the bundle CSS, in order:
    //
    // 1. Tailwind v4 output compiled from studio/src/styles/tailwind.css
    //    with @source pointing at this frame's dir. Without this, classes
    //    the frame uses but arcade-gen didn't happen to use are missing.
    // 2. Inlined @font-face rules (CDN Referer-blocks .vercel.app origins,
    //    so the browser can't fetch fonts at runtime).
    //
    // Order matters for @font-face override: ours come after arcade-gen's
    // so "last matching family wins" picks ours.
    const frameTailwindCss = await buildFrameTailwindCss(ctx.framePath);
    const inlineFonts = await buildInlineFontFaceCss();
    const css =
      (cssOutput?.text || "") +
      (frameTailwindCss ? "\n" + frameTailwindCss : "") +
      (inlineFonts ? "\n" + inlineFonts : "");

    // Ship JS and CSS as separate files, not inlined. If the minified JS
    // happens to contain a "</script>" substring (e.g. inside a string
    // literal), inlining via <script>...</script> terminates the tag early
    // and the remainder of the bundle renders as visible text — exactly the
    // "blank page with a long hash" symptom a beta tester hit.
    const html = `<!DOCTYPE html>
<html lang="en" data-theme="${ctx.theme}" class="${ctx.mode}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${ctx.projectSlug} - ${ctx.frameSlug}</title>
    <link rel="stylesheet" href="/assets/bundle.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/bundle.js"></script>
  </body>
</html>`;

    await fs.rm(tempDir, { recursive: true, force: true });

    return { html, js, css };
  } catch (err: any) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Bundle failed: ${err.message}`);
  }
}
