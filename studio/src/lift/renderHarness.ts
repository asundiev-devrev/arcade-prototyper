// studio/src/lift/renderHarness.ts
//
// Build a <render_harness> block for the manifest. The idea is to close
// the loop at the cheapest possible point: after the agent writes code,
// it should actually render the result in a browser and read computed
// styles, not just typecheck. A single convention block can't prescribe
// this well because verification instructions depend on which OTHER
// conventions fired — a frame with inline style tokens needs a different
// checklist than one with hand-rolled overlays.
//
// Deliberately target-codebase-agnostic: the harness names a `tmp/lift`
// scratch path, a `{frameSlug}` URL placeholder, and an `hsl(var(--X))`
// backdrop hint. Consumers running lifts against a non-Storybook target
// can ignore the targetPath and iframeUrl and still get the checklist.
//
// Added 2026-05-13 after a live render loop on 01-skills-gallery
// surfaced three classes of bug that text-level review had missed.

import type { Manifest, RenderHarness } from "./types";

export function buildRenderHarness(m: Manifest): RenderHarness {
  const targetPath = `tmp/lift/${m.frameSlug}.tsx`;

  // A clean React component name derived from the slug, used both for the
  // default export and to predict the Storybook story id. Storybook lowercases
  // the story title and strips non-alphanumerics into single hyphens, so the
  // id is fully derivable here — no guessing at render time.
  const pascal = m.frameSlug
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  const componentName = /^[A-Za-z]/.test(pascal) ? pascal : `Frame${pascal}`;
  // Storybook id algorithm: kebab-case(title) + "--" + kebab-case(exportName).
  // Title is "Lift Validation/<ComponentName>", export is `Default`.
  const storyId = `lift-validation-${componentName.toLowerCase()}--default`;

  const iframeUrl = `http://localhost:4400/iframe.html?id=${storyId}&viewMode=story`;

  // The scaffold that makes the render actually happen. The point is to
  // remove every excuse the agent reached for last time ("iframe_url was a
  // placeholder", "no Storybook story", "bare tmp/lift/ file") by handing it
  // the exact files, location, launch command, and predicted URL.
  const storyScaffold = [
    "SCOPE: the render-validation story below is an EXPECTED, IN-SCOPE",
    "verification artifact of this lift — NOT a codebase modification. It is",
    "throwaway scratch (same category as the tmp/lift file itself), deleted",
    "after you read the computed styles. A kickoff rule like \"only write the",
    "lift file\" or \"don't change anything else\" does NOT forbid it: rendering",
    "IS the lift's verification step, and these files are its scaffolding. Do",
    "not skip the render and flag it as a gap — create the scratch story,",
    "render, read styles, then delete the story. If a real constraint makes",
    "even scratch files impossible, say so explicitly and name what blocked it.",
    "",
    "DO NOT stop at static grep — a class string existing in the file does",
    "NOT prove it paints (see baseline check below). To get a live render:",
    "",
    "1. Co-locate the lifted component AND a paired story in a directory the",
    "   Storybook glob already scans and the DS ThemeProvider already wraps:",
    "     libs/agent-platform/feature/agent-studio/src/stories/__lift_validation/",
    `   Write the component as ${componentName.toLowerCase()}.tsx (default export`,
    `   \`${componentName}\`) and ${componentName.toLowerCase()}.stories.tsx beside it.`,
    "",
    "2. Story file (mirror the existing skills-gallery.stories.tsx in that dir):",
    "     import { Decorator, Meta } from '@storybook/nextjs';",
    "     import { MemoryRouter, Route, Routes } from 'react-router-dom';",
    `     import ${componentName} from './${componentName.toLowerCase()}';`,
    "     const withRouter: Decorator = (Story) => (",
    "       <MemoryRouter initialEntries={['/']}>",
    "         <Routes><Route path=\"/*\" element={<Story />} /></Routes>",
    "       </MemoryRouter>",
    "     );",
    "     export default {",
    "       decorators: [withRouter], tags: ['lift-validation'],",
    `       title: 'Lift Validation/${componentName}',`,
    "       parameters: { layout: 'fullscreen' },",
    "     } as Meta;",
    `     export const Default = () => <${componentName} />;`,
    "",
    "3. Launch Storybook (from the devrev-web root): `pnpm run start:storybook`.",
    "   It binds on http://localhost:4400 (NOT 6006). The first cold build",
    "   takes a few minutes; poll the port before navigating.",
    "",
    "   GOTCHA: Storybook bundles ALL stories into one preview — a single",
    "   pre-existing story with a stale import will fail the whole build and",
    "   the port never binds. If start fails, read the log for `ERROR in`;",
    "   if the broken file is NOT yours, temporarily move it aside, render,",
    "   then restore it.",
    "",
    `4. Navigate to: ${iframeUrl}`,
    "   Then run the checks below against the live computed styles.",
    "",
    "5. Clean up: delete the scratch component + story you created in step 1",
    "   (and restore anything you moved aside in step 3). The lift's only",
    "   durable output is the tmp/lift file.",
    "",
    "If Storybook is genuinely unavailable, you still owe a live render via",
    "some isolated entry — do not substitute grep and call the lift verified.",
  ].join("\n");

  const backdropNote =
    "Wrap the rendered story in a decorator that gives it a non-white " +
    "backdrop — many DS border tokens resolve to near-white (e.g. " +
    "`#FAFAFA`) and will vanish against a pure-white iframe. A simple " +
    '`<div className="min-h-screen bg-[hsl(var(--bg-surface-shallow))]">` ' +
    "wrapper is enough when the target codebase's tokens are raw HSL " +
    "channels; if the token is already a full color, omit the `hsl()` " +
    "wrap.";

  const checks: string[] = [
    "GREP DOES NOT PROVE PAINT. Confirming a class string exists in the file (or is 'used somewhere' by grep) does NOT verify it resolves to a color in THIS render context — many tokens are app-scoped or theme-gated and fall through to transparent/currentColor. Every visual claim below must come from a LIVE computed style read (getComputedStyle), never from grep.",
    "No browser console errors or unresolved React errors on first mount.",
    "For each card/container, computed `borderColor` is a real color (not transparent, not `rgb(0,0,0)`/near-black). Near-black borders on a light-theme render almost always mean a token fell through to Tailwind's `currentColor` default.",
    "For each element that Studio gave a `background`, computed `backgroundColor` is NOT `rgba(0, 0, 0, 0)` (transparent) unless the Studio source was also transparent. A transparent background usually means a theme variable was embedded inline as a raw HSL triple and silently invalidated, OR the utility's backing token is app-scoped and undefined in this shell (see app_scoped_token_convention).",
    "Active/selected states (e.g. tab underline, button hover) render visibly. If the active tab has the same color as an inactive tab, a state token didn't resolve.",
  ];

  // Conditional checks — only add when a convention that produces this
  // class of bug has fired. Keeps the list short and actionable per-frame.
  if (m.hasInlineStyleTokens) {
    checks.push(
      "Every `style={{ ... var(--X) ... }}` in the Studio source was rewritten per `style_attribute_convention`; grep the lifted file for `style={{` and confirm none of the remaining ones reference a `var(--bg-|--fg-|--stroke-|--border-|--color-)`.",
    );
    checks.push(
      "Spot-check any container's computed `borderColor` and `backgroundColor`: both must resolve to `rgb(...)` values with matching hex digits to the Figma source, not fall back to text color. A good evaluate to paste in DevTools: `getComputedStyle($0).borderTopColor`.",
    );
  }
  if (m.hasOverlay) {
    checks.push(
      "The overlay is driven by `<Modal open={...} onOpenChange={...}>` from the target DS, NOT by preserved `fixed inset-0` divs. Grep the lifted file for `fixed inset-0` — zero matches expected.",
    );
  }
  if (m.iconImports.length > 0) {
    checks.push(
      "Every icon in the lifted file uses the target DS's icon enum (e.g. `ICON_TYPES.X`) — NOT the Studio-source named icon component (e.g. `<LightingBolt/>`). Grep the lifted file for the Studio-source icon names — zero matches expected.",
    );
  }
  // close-but-not-identity mappings almost always need a wrapper (Radix-
  // style optional-arg callbacks, onChange signature narrowing, etc.).
  // Make the agent confirm per-delta notes were actually applied.
  const closeEntries = m.mappings.filter(
    (e) => e.translationClass === "close-but-not-identity",
  );
  if (closeEntries.length > 0) {
    const names = closeEntries.map((e) => e.studio.name).join(", ");
    checks.push(
      `For each close-but-not-identity mapping (${names}), confirm the propDeltas' "wrap" / "narrow" guidance was applied verbatim at every call site. A bare setState or identity handler will typecheck-fail or render wrong.`,
    );
  }

  // App-scoped token check — fires when the frame uses a construct whose
  // production translation pulls in an app-scoped color utility (ChatBubble
  // → bg-user-bubble-primary). This is the exact bug the live 01-chat-with-
  // canvas lift shipped: the sender bubble rendered transparent because the
  // token is undefined outside portal-shell / plug-widget.
  const importsChatBubble = m.imports.some((i) => i.names.includes("ChatBubble"));
  if (importsChatBubble) {
    checks.push(
      "Sender (user) chat bubble: read its computed `backgroundColor` AND `color`. If you used `bg-user-bubble-primary` / `!text-user-bubble-primary`, both will be `rgba(0, 0, 0, 0)` / fall-through UNLESS the target app shell defines `--bg-user-bubble-primary-color` (only portal-shell & plug-widget do). A transparent sender bubble = the app_scoped_token_convention case: swap to a global token (`bg-menu-selected`) or get the reviewer's intended fill.",
    );
  }

  return { targetPath, iframeUrl, backdropNote, storyScaffold, checks };
}
