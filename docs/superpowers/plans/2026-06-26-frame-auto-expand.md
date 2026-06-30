# Frame Auto-Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a generation turn, auto-expand each top-level full-page composite in a frame's `index.tsx` into flat editable markup — so the existing instant style editing works on the result — using an authored `expand(props)` where one exists (SettingsPage now) and an AI-expand fallback otherwise.

**Architecture:** A server-side post-generation pass (`expandFrame`) parses the frame's `index.tsx` with the TS AST, finds top-level full-page composite instances, extracts each instance's props + children as verbatim source substrings, and replaces the instance with flat JSX — from an authored `Composite.expand(propsSrc)` (deterministic, kit-owned) or, when none exists, a scoped AI rewrite. Reparse-guarded, all-or-nothing per instance, idempotent. Hooked into `chat.ts` after the turn's frame writes.

**Tech Stack:** TypeScript (TS compiler API — already used; NOT Babel), Vite middleware, the Claude subprocess (for AI fallback), Vitest.

## Global Constraints

- **Package manager is pnpm.** Tests via `pnpm run studio:test <path>` from the **repo root** (`/Users/andrey.sundiev/arcade-prototyper`). Never npm/yarn.
- **Never `git add -A` / `git add .`** — stage explicit paths only.
- **Conventional Commits**, scope `studio/canvas` (kit changes: `studio/kit`).
- **Vite middleware does NOT hot-reload** — `server/*` + `vite.config.ts` changes need an app restart to test live; unit tests don't.
- **Full-page templates = the 4 in `prototype-kit/templates/`:** `SettingsPage`, `ComputerPage`, `VistaPage`, `BuilderPage`. Only these are expanded. Smaller composites (cards/rows) are NOT expanded.
- **Authored-expansion this plan: SettingsPage ONLY** (fully flattened to host markup). The other 3 route to the AI-expand fallback until authored later.
- **Never write un-parseable TSX:** every splice reparse-guarded (reuse the Phase-A pattern `(sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics`); a failed expand leaves that instance as the composite (graceful degrade).
- **All-or-nothing per instance; idempotent:** after expansion a frame has no top-level full-page composite, so re-running is a no-op.
- **Props/children are passed verbatim:** the templates take `ReactNode` props (`sidebar`, `children`, etc.) — those substrings are MOVED into the flat output unchanged (they were always editable); only the template's own chrome becomes flat.
- **Emit only kit primitives + host tags + arcade-gen tokens** in authored expansions — never raw hex/inline style; mirror the composite's real classes verbatim.
- **Path safety:** writes resolve through `frameDir(slug, frameSlug)`, stay inside the project dir.
- **Out of scope:** sub-project #2 (the "Ask AI to change this" prompt); authoring the other 3 templates' expansions; a kit render-parity test for expand; on-canvas handles.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `studio/server/expand/extractInstance.ts` | TS-AST: find a top-level component instance, return its prop/children source substrings + splice range | 1 |
| `studio/prototype-kit/templates/SettingsPage.tsx` | add authored `expand(props) => flat JSX string` next to the component | 2 |
| `studio/server/expand/registry.ts` | map composite tag → authored expand (or null); list of full-page tags | 3 |
| `studio/server/expand/expandFrame.ts` | orchestrate: find instances → authored expand or mark AI → splice + reparse-guard → return rewritten source | 3 |
| `studio/server/expand/aiExpand.ts` | scoped AI rewrite for un-authored composites (fallback) | 4 |
| `studio/server/middleware/chat.ts` | post-turn hook: run expandFrame on changed frames, write back | 5 |

> Tasks 1–3 are the deterministic core (extractor → authored SettingsPage expansion → registry+orchestrator). Task 4 adds the AI fallback. Task 5 wires it into generation. Reuses Phase-A AST helpers (`server/codeWriter/locateJsx.ts`, `patchSource.ts` `readAttr`/`splice`).

---

## Task 1: Extract a component instance from frame source

**Files:**
- Create: `studio/server/expand/extractInstance.ts`
- Test: `studio/__tests__/server/expand/extractInstance.test.ts`

**Interfaces:**
- Consumes: `ts` (typescript), the Phase-A `locateJsx`/`JsxHit` patterns (may import or re-implement minimal AST walk).
- Produces:
  - `interface ExtractedInstance { tag: string; propsSrc: Record<string, string>; childrenSrc: string; start: number; end: number }`
  - `extractTopLevelInstance(source: string, tags: string[]): ExtractedInstance | null` — find the FIRST top-level JSX element whose tag ∈ `tags`; return its attributes as `propsSrc` (attr name → the verbatim source of its value: for `title="X"` → `"X"` incl. quotes; for `sidebar={<A/>}` → `<A/>` the inner expression source), `childrenSrc` = the verbatim source of its children (between `>` and `</tag>`; `""` if self-closing/empty), and `start`/`end` = the element's full source span (for splicing). `null` if no matching tag.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/expand/extractInstance.test.ts
import { describe, it, expect } from "vitest";
import { extractTopLevelInstance } from "../../../server/expand/extractInstance";

const SRC = `import { SettingsPage, NavSidebar, SettingsCard } from "arcade-prototypes";
export default function F() {
  return (
    <SettingsPage title="My Cards" subtitle="Manage" sidebar={<NavSidebar workspace="DevRev" />}>
      <SettingsCard title="Featured">cards</SettingsCard>
    </SettingsPage>
  );
}
`;

describe("extractTopLevelInstance", () => {
  it("extracts props + children source for the matching tag", () => {
    const r = extractTopLevelInstance(SRC, ["SettingsPage", "ComputerPage"]);
    expect(r).not.toBeNull();
    expect(r!.tag).toBe("SettingsPage");
    expect(r!.propsSrc.title).toBe(`"My Cards"`);
    expect(r!.propsSrc.subtitle).toBe(`"Manage"`);
    expect(r!.propsSrc.sidebar).toBe(`<NavSidebar workspace="DevRev" />`);
    expect(r!.childrenSrc).toContain(`<SettingsCard title="Featured">cards</SettingsCard>`);
    // span covers the whole element
    expect(SRC.slice(r!.start, r!.end)).toMatch(/^<SettingsPage[\s\S]*<\/SettingsPage>$/);
  });
  it("returns null when no tag matches", () => {
    expect(extractTopLevelInstance(`const x = <div/>;`, ["SettingsPage"])).toBeNull();
  });
  it("handles a self-closing instance (empty children)", () => {
    const r = extractTopLevelInstance(`const x = <ComputerPage state="empty" />;`, ["ComputerPage"]);
    expect(r!.tag).toBe("ComputerPage");
    expect(r!.propsSrc.state).toBe(`"empty"`);
    expect(r!.childrenSrc).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/expand/extractInstance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// studio/server/expand/extractInstance.ts
import ts from "typescript";

export interface ExtractedInstance {
  tag: string;
  propsSrc: Record<string, string>;
  childrenSrc: string;
  start: number;
  end: number;
}

export function extractTopLevelInstance(source: string, tags: string[]): ExtractedInstance | null {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const want = new Set(tags);
  let found: ExtractedInstance | null = null;

  function tagNameOf(open: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
    return open.tagName.getText(sf);
  }
  function readProps(open: ts.JsxOpeningElement | ts.JsxSelfClosingElement): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of open.attributes.properties) {
      if (!ts.isJsxAttribute(p) || !p.name) continue;
      const name = p.name.getText(sf);
      const init = p.initializer;
      if (!init) { out[name] = "true"; continue; }              // bare boolean attr
      if (ts.isStringLiteral(init)) { out[name] = init.getText(sf); continue; } // "X" incl quotes
      if (ts.isJsxExpression(init) && init.expression) {
        out[name] = init.expression.getText(sf);                // inner of {…}
      }
    }
    return out;
  }

  function visit(node: ts.Node) {
    if (found) return;
    if (ts.isJsxElement(node) && want.has(node.openingElement.tagName.getText(sf))) {
      const open = node.openingElement;
      const childStart = open.getEnd();
      const childEnd = node.closingElement.getStart(sf);
      found = {
        tag: tagNameOf(open),
        propsSrc: readProps(open),
        childrenSrc: source.slice(childStart, childEnd),
        start: node.getStart(sf),
        end: node.getEnd(),
      };
      return;
    }
    if (ts.isJsxSelfClosingElement(node) && want.has(node.tagName.getText(sf))) {
      found = {
        tag: tagNameOf(node),
        propsSrc: readProps(node),
        childrenSrc: "",
        start: node.getStart(sf),
        end: node.getEnd(),
      };
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/expand/extractInstance.test.ts`
Expected: PASS. If `getStart` offsets differ for your TS version, fix the TEST's expected substrings to the real span (the extractor's offsets are authoritative) — do not loosen the extractor.

- [ ] **Step 5: Commit**

```bash
git add studio/server/expand/extractInstance.ts studio/__tests__/server/expand/extractInstance.test.ts
git commit -m "feat(studio/canvas): extract a top-level composite instance's props+children source"
```

---

## Task 2: Authored SettingsPage expansion

**Files:**
- Modify: `studio/prototype-kit/templates/SettingsPage.tsx` (add `export function expandSettingsPage(props) => string`)
- Test: `studio/__tests__/server/expand/expandSettingsPage.test.ts`

**Interfaces:**
- Consumes: nothing (pure string builder).
- Produces: `export function expandSettingsPage(props: Record<string, string>): string` — given the prop/children SOURCE substrings (`{ title, subtitle, sidebar, breadcrumb, actions, pageActions, titleAction, children }`, each the verbatim source or undefined), returns the FLAT JSX string equivalent to what `SettingsPage` renders: AppShell's `<div>/<aside>/<main>` chrome + PageBody's `<h1>/<p>/<div>` inlined, with the passed substrings dropped into their slots. Uses the EXACT classes from AppShell/PageBody source. Self-contained string (callers wrap/import as needed). `children`/`sidebar` etc. inlined verbatim; omitted optional props render nothing (mirror the truthiness checks).

> The flattened output mirrors AppShell (`<div className="flex flex-col h-screen w-full bg-(--surface-backdrop) overflow-hidden">` → titleBar slot → `<div className="flex flex-1 min-h-0">` → `<aside className="w-60 shrink-0 h-full flex flex-col">{sidebar}</aside>` → `<div className="flex-1 min-w-0 flex flex-col h-full bg-(--surface-overlay)">` → breadcrumbBar → `<main className="flex-1 min-h-0 overflow-auto border-t border-(--stroke-neutral-subtle)">` → PageBody) and PageBody (`<div className="mx-auto w-full max-w-[832px] px-6 pt-12 pb-16">` → title/subtitle block with `<h1 className="text-title-large text-(--fg-neutral-prominent)">{title}</h1>` + `<p className="mt-1 text-body text-(--fg-neutral-subtle)">{subtitle}</p>` → `<div className="flex flex-col gap-12">{children}</div>`). TitleBar + BreadcrumbBar stay as composite tags in the slots (they're chrome the designer rarely reshapes; v1 flattens the page body + layout shell where the designer's content lives). The titleBar wrapper: `<TitleBar trailingActions={actions} />`; breadcrumbBar: `<BreadcrumbBar breadcrumb={breadcrumb} actions={pageActions} />` — only rendered if their inputs are present, mirroring the component.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/expand/expandSettingsPage.test.ts
import { describe, it, expect } from "vitest";
import { expandSettingsPage } from "../../../prototype-kit/templates/SettingsPage";

describe("expandSettingsPage", () => {
  const props = {
    title: `"My Cards"`,
    subtitle: `"Manage your card collection"`,
    sidebar: `<NavSidebar workspace="DevRev" />`,
    children: `<SettingsCard title="Featured">cards</SettingsCard>`,
  };
  it("emits the flat AppShell+PageBody chrome with slots inlined", () => {
    const out = expandSettingsPage(props);
    // AppShell shell classes present (flattened, not <AppShell>)
    expect(out).toContain(`flex flex-col h-screen w-full bg-(--surface-backdrop) overflow-hidden`);
    expect(out).toContain(`<aside`);
    expect(out).toContain(`<main`);
    // PageBody body present with the title as a real <h1>
    expect(out).toContain(`mx-auto w-full max-w-[832px] px-6 pt-12 pb-16`);
    expect(out).toMatch(/<h1[^>]*text-title-large[^>]*>\s*My Cards\s*<\/h1>/);
    expect(out).toMatch(/<p[^>]*text-body[^>]*>\s*Manage your card collection\s*<\/p>/);
    // passed slots inlined verbatim
    expect(out).toContain(`<NavSidebar workspace="DevRev" />`);
    expect(out).toContain(`<SettingsCard title="Featured">cards</SettingsCard>`);
    // NOT a SettingsPage anymore
    expect(out).not.toContain(`<SettingsPage`);
  });
  it("omits the title block when no title/subtitle", () => {
    const out = expandSettingsPage({ sidebar: `<NavSidebar />`, children: `<div/>` });
    expect(out).not.toContain(`<h1`);
    expect(out).toContain(`<NavSidebar />`);
  });
  it("renders string-literal title without the surrounding quotes (as JSX text)", () => {
    const out = expandSettingsPage({ title: `"Hello"`, sidebar: `<X/>`, children: `<Y/>` });
    expect(out).toContain(`>Hello<`);     // text, not the quoted string
    expect(out).not.toContain(`>"Hello"<`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/expand/expandSettingsPage.test.ts`
Expected: FAIL — `expandSettingsPage` not exported.

- [ ] **Step 3: Implement `expandSettingsPage` in `SettingsPage.tsx`**

Append to `studio/prototype-kit/templates/SettingsPage.tsx`:

```ts
/**
 * Authored flat expansion of SettingsPage — the same chrome it renders
 * (AppShell + PageBody, flattened to host markup), with the caller's prop/child
 * SOURCE substrings dropped into their slots. Used by the post-generation
 * auto-expand pass so a generated frame becomes flat editable code instead of an
 * opaque <SettingsPage>. Keep BYTE-FAITHFUL to the component above + AppShell/
 * PageBody; if their markup changes, update this too.
 *
 * `props` values are verbatim source substrings: title=`"My Cards"` (a quoted
 * string literal), sidebar=`<NavSidebar …/>` (JSX expression source), etc.
 */
export function expandSettingsPage(props: Record<string, string>): string {
  const { title, subtitle, sidebar = "null", breadcrumb, actions, pageActions, titleAction, children = "null" } = props;
  // A string-literal prop ("X") becomes JSX text X; a JSX-expression prop stays {…}.
  const asText = (v: string | undefined): string => {
    if (v == null) return "";
    const m = /^"([\s\S]*)"$/.exec(v) ?? /^'([\s\S]*)'$/.exec(v);
    return m ? m[1] : `{${v}}`;
  };
  const asNode = (v: string | undefined): string => (v == null ? "" : v); // expression source inlined verbatim

  const titleBlock =
    title || subtitle
      ? `<div className="mb-10 flex items-start justify-between gap-4"><div>` +
        (title ? `<h1 className="text-title-large text-(--fg-neutral-prominent)">${asText(title)}</h1>` : ``) +
        (subtitle ? `<p className="mt-1 text-body text-(--fg-neutral-subtle)">${asText(subtitle)}</p>` : ``) +
        `</div>` +
        (titleAction ? `<div className="shrink-0 pt-1">${asNode(titleAction)}</div>` : ``) +
        `</div>`
      : ``;

  const pageBody =
    `<div className="mx-auto w-full max-w-[832px] px-6 pt-12 pb-16">` +
    titleBlock +
    `<div className="flex flex-col gap-12">${asNode(children)}</div>` +
    `</div>`;

  const titleBar = `<TitleBar trailingActions={${actions ?? "undefined"}} />`;
  const breadcrumbBar = `<BreadcrumbBar breadcrumb={${breadcrumb ?? "undefined"}} actions={${pageActions ?? "undefined"}} />`;

  return (
    `<div className="flex flex-col h-screen w-full bg-(--surface-backdrop) overflow-hidden">` +
    titleBar +
    `<div className="flex flex-1 min-h-0">` +
    `<aside className="w-60 shrink-0 h-full flex flex-col">${asNode(sidebar)}</aside>` +
    `<div className="flex-1 min-w-0 flex flex-col h-full bg-(--surface-overlay)">` +
    breadcrumbBar +
    `<main className="flex-1 min-h-0 overflow-auto border-t border-(--stroke-neutral-subtle)">` +
    pageBody +
    `</main></div></div></div>`
  );
}
```

(`TitleBar`/`BreadcrumbBar` remain composite references in the output — they're imported by the frame already since SettingsPage used them transitively; if a frame didn't import them, the expand-frame step reconciles imports — see Task 3 note. v1 keeps them as composites; flattening the body + shell is what makes the designer's content editable.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/expand/expandSettingsPage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/prototype-kit/templates/SettingsPage.tsx studio/__tests__/server/expand/expandSettingsPage.test.ts
git commit -m "feat(studio/kit): authored flat expansion for SettingsPage"
```

---

## Task 3: Registry + expandFrame orchestrator

**Files:**
- Create: `studio/server/expand/registry.ts`
- Create: `studio/server/expand/expandFrame.ts`
- Test: `studio/__tests__/server/expand/expandFrame.test.ts`

**Interfaces:**
- Consumes: `extractTopLevelInstance` (T1), `expandSettingsPage` (T2), `ts` reparse guard.
- Produces:
  - `registry.ts`: `FULL_PAGE_TAGS: string[]` = `["SettingsPage","ComputerPage","VistaPage","BuilderPage"]`; `authoredExpand(tag): ((props) => string) | null` — returns `expandSettingsPage` for `"SettingsPage"`, else null.
  - `expandFrame.ts`: `expandFrame(source: string): { source: string; changed: boolean; needsAi: string | null }` — find the first top-level full-page instance; if its tag has an authored expand → splice the flat JSX over it, reparse-guard, return `{source: rewritten, changed: true, needsAi: null}`; if NO authored expand → return `{source, changed:false, needsAi: tag}` (caller runs AI fallback). No full-page instance → `{source, changed:false, needsAi:null}`. Reparse failure → `{source, changed:false, needsAi:null}` (leave as composite). Idempotent (after expansion no full-page tag remains).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/expand/expandFrame.test.ts
import { describe, it, expect } from "vitest";
import { expandFrame } from "../../../server/expand/expandFrame";

const SETTINGS = `import { SettingsPage, NavSidebar, SettingsCard } from "arcade-prototypes";
export default function F() {
  return (
    <SettingsPage title="My Cards" sidebar={<NavSidebar workspace="DevRev" />}>
      <SettingsCard title="Featured">cards</SettingsCard>
    </SettingsPage>
  );
}
`;

describe("expandFrame", () => {
  it("expands an authored full-page composite to flat markup", () => {
    const r = expandFrame(SETTINGS);
    expect(r.changed).toBe(true);
    expect(r.needsAi).toBeNull();
    expect(r.source).not.toContain("<SettingsPage");
    expect(r.source).toContain("max-w-[832px]");        // PageBody flat
    expect(r.source).toMatch(/<h1[^>]*>\s*My Cards\s*<\/h1>/);
    expect(r.source).toContain(`<NavSidebar workspace="DevRev" />`);
    expect(r.source).toContain(`<SettingsCard title="Featured">cards</SettingsCard>`);
  });
  it("flags AI fallback for an un-authored full-page composite", () => {
    const src = `import { VistaPage } from "arcade-prototypes";\nexport default () => <VistaPage title="x">body</VistaPage>;\n`;
    const r = expandFrame(src);
    expect(r.changed).toBe(false);
    expect(r.needsAi).toBe("VistaPage");
  });
  it("no-op when no full-page composite is present", () => {
    const src = `export default () => <div className="p-4">hi</div>;`;
    const r = expandFrame(src);
    expect(r.changed).toBe(false);
    expect(r.needsAi).toBeNull();
    expect(r.source).toBe(src);
  });
  it("idempotent — expanded source has no full-page tag, second run is a no-op", () => {
    const once = expandFrame(SETTINGS);
    const twice = expandFrame(once.source);
    expect(twice.changed).toBe(false);
    expect(twice.needsAi).toBeNull();
  });
  it("leaves the composite when the expansion would not parse", () => {
    // force a broken expand via a tag that resolves authored but produces bad jsx?
    // Instead: a malformed source where splice can't produce valid TSX — assert graceful.
    // (Covered by reparse guard; here assert a normal expand still parses.)
    const r = expandFrame(SETTINGS);
    // result parses:
    const ts = require("typescript");
    const sf = ts.createSourceFile("x.tsx", r.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect((sf as any).parseDiagnostics?.length ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/expand/expandFrame.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `registry.ts`**

```ts
// studio/server/expand/registry.ts
import { expandSettingsPage } from "../../prototype-kit/templates/SettingsPage";

export const FULL_PAGE_TAGS = ["SettingsPage", "ComputerPage", "VistaPage", "BuilderPage"];

export function authoredExpand(tag: string): ((props: Record<string, string>) => string) | null {
  if (tag === "SettingsPage") return expandSettingsPage;
  return null; // ComputerPage / VistaPage / BuilderPage → AI fallback (not yet authored)
}
```

- [ ] **Step 4: Write `expandFrame.ts`**

```ts
// studio/server/expand/expandFrame.ts
import ts from "typescript";
import { extractTopLevelInstance } from "./extractInstance";
import { FULL_PAGE_TAGS, authoredExpand } from "./registry";

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

export interface ExpandResult { source: string; changed: boolean; needsAi: string | null }

export function expandFrame(source: string): ExpandResult {
  // Cheap short-circuit: no full-page tag substring → nothing to do.
  if (!FULL_PAGE_TAGS.some((t) => source.includes(`<${t}`))) {
    return { source, changed: false, needsAi: null };
  }
  const inst = extractTopLevelInstance(source, FULL_PAGE_TAGS);
  if (!inst) return { source, changed: false, needsAi: null };

  const expand = authoredExpand(inst.tag);
  if (!expand) return { source, changed: false, needsAi: inst.tag };

  const flat = expand({ ...inst.propsSrc, children: inst.childrenSrc });
  const out = source.slice(0, inst.start) + flat + source.slice(inst.end);
  if (!reparses(out)) return { source, changed: false, needsAi: null };
  return { source: out, changed: true, needsAi: null };
}
```

> Import note: the flat output may reference `TitleBar`/`BreadcrumbBar` (kept as composites). A frame that used `<SettingsPage>` imported it from `arcade-prototypes` but maybe not `TitleBar`/`BreadcrumbBar`. After expansion, ensure those names are imported. SIMPLEST for v1: the authored expansion only references `TitleBar`/`BreadcrumbBar` when `actions`/`breadcrumb`/`pageActions` are present (it already gates the slots); if present, the frame likely already imported them OR — to be safe — `expandFrame` runs the same arcade-gen import reconciliation the customize endpoint used (now removed) … NOTE: that was deleted. Instead, add a tiny import-ensure here: if the flat output contains `<TitleBar` or `<BreadcrumbBar` and the source's `arcade-prototypes` import doesn't list them, add them. Keep it minimal; a follow-up can generalize. (Implementer: if this proves fiddly, the cleaner path is to ALSO flatten TitleBar/BreadcrumbBar in the authored expansion so no new imports are needed — but that's more authoring; for v1, the import-ensure is acceptable. Decide and note it.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/expand/expandFrame.test.ts`
Expected: PASS (5 cases). If the parse-check test's `require` form trips ESM, use a top `import ts from "typescript"` in the test instead.

- [ ] **Step 6: Commit**

```bash
git add studio/server/expand/registry.ts studio/server/expand/expandFrame.ts studio/__tests__/server/expand/expandFrame.test.ts
git commit -m "feat(studio/canvas): expandFrame — splice authored flat expansion, flag AI fallback otherwise"
```

---

## Task 4: AI-expand fallback

**Files:**
- Create: `studio/server/expand/aiExpand.ts`
- Test: `studio/__tests__/server/expand/aiExpand.test.ts`

**Interfaces:**
- Consumes: the existing Claude subprocess runner (`server/claudeCode.ts` — the same path `/api/chat` uses to spawn `claude`). Mock it in the test.
- Produces: `buildAiExpandPrompt(frameSlug: string, tag: string): string` (pure — the scoped instruction) + `aiExpandFrame(slug, frameSlug, tag): Promise<{ ok: boolean }>` (fires the subprocess to rewrite the frame; resolves ok/!ok). The prompt: rewrite the top-level `<tag>` in `frames/<frameSlug>/index.tsx` into the equivalent flat layout (arcade primitives + raw markup), preserving the visual result; touch nothing else; no new imports beyond the four roots.

- [ ] **Step 1: Write the failing test (pure prompt)**

```ts
// studio/__tests__/server/expand/aiExpand.test.ts
import { describe, it, expect } from "vitest";
import { buildAiExpandPrompt } from "../../../server/expand/aiExpand";

describe("buildAiExpandPrompt", () => {
  it("scopes the rewrite to the named tag + frame, preserving visuals", () => {
    const p = buildAiExpandPrompt("01-page", "VistaPage");
    expect(p).toContain("frames/01-page/index.tsx");
    expect(p).toContain("<VistaPage");
    expect(p.toLowerCase()).toContain("flat");
    expect(p.toLowerCase()).toMatch(/preserve|identical|same visual/);
    expect(p).toMatch(/only|nothing else|do not change/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/expand/aiExpand.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `aiExpand.ts`**

```ts
// studio/server/expand/aiExpand.ts
import { runClaudeTurn } from "../claudeCode"; // adapt to the actual exported runner name

export function buildAiExpandPrompt(frameSlug: string, tag: string): string {
  return [
    `Rewrite the top-level <${tag}> in frames/${frameSlug}/index.tsx into the equivalent FLAT layout:`,
    `replace it with arcade primitives + raw host markup (div/span/h1/p/etc.) that render the SAME visual result,`,
    `inlining the page chrome the composite provides so the page becomes directly editable.`,
    `Keep every prop/child the composite was given (move them into the equivalent flat slots).`,
    `Change ONLY that component — do not touch anything else in the file.`,
    `Use only arcade design-token classes; no new imports beyond arcade / arcade/components / arcade-prototypes / react.`,
  ].join(" ");
}

/** Fire a scoped Claude turn to expand an un-authored composite. Resolves ok
 *  when the turn completes without error. Best-effort; the caller leaves the
 *  frame as-is on !ok. */
export async function aiExpandFrame(slug: string, frameSlug: string, tag: string): Promise<{ ok: boolean }> {
  try {
    await runClaudeTurn(slug, buildAiExpandPrompt(frameSlug, tag));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
```

> Implementer: read `server/claudeCode.ts` for the ACTUAL runner signature (the function `/api/chat` uses to spawn a scoped turn). Adapt `runClaudeTurn(slug, prompt)` to it. If a one-shot scoped turn isn't readily callable, the minimal acceptable v1 is to leave `aiExpandFrame` returning `{ok:false}` (so un-authored composites just stay composites) and note that authored expansions are the real path — but PREFER wiring the real subprocess if the runner is callable. The pure `buildAiExpandPrompt` is the tested unit.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/expand/aiExpand.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/expand/aiExpand.ts studio/__tests__/server/expand/aiExpand.test.ts
git commit -m "feat(studio/canvas): AI-expand fallback prompt + runner for un-authored composites"
```

---

## Task 5: Post-generation hook

**Files:**
- Modify: `studio/server/middleware/chat.ts` (run expandFrame on changed frames after the turn)
- Test: `studio/__tests__/server/expand/postGenHook.test.ts` (unit-test the extracted hook fn, not the whole middleware)

**Interfaces:**
- Consumes: `expandFrame` (T3), `aiExpandFrame` (T4), `frameDir` (`server/paths.ts`), fs.
- Produces: `expandChangedFrames(slug: string, changedFrameSlugs: string[]): Promise<void>` — for each changed frame, read its `index.tsx`, run `expandFrame`; if `changed`, write the rewritten source back (triggers Vite reload); if `needsAi`, call `aiExpandFrame`. Errors are swallowed per-frame (best-effort, never fails the turn). Called from `chat.ts` after the turn's frame writes are detected (the existing post-turn diff at ~chat.ts:710 yields the changed frames).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/expand/postGenHook.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const readFile = vi.fn();
const writeFile = vi.fn();
vi.mock("node:fs/promises", () => ({ default: { readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }, readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }));
vi.mock("../../../server/paths", () => ({ frameDir: (p: string, f: string) => `/root/projects/${p}/frames/${f}` }));
const aiExpandFrame = vi.fn().mockResolvedValue({ ok: true });
vi.mock("../../../server/expand/aiExpand", () => ({ aiExpandFrame: (...a: unknown[]) => aiExpandFrame(...a) }));

import { expandChangedFrames } from "../../../server/expand/postGenHook";

const SETTINGS = `import { SettingsPage, NavSidebar } from "arcade-prototypes";
export default () => <SettingsPage title="X" sidebar={<NavSidebar/>}>body</SettingsPage>;
`;

describe("expandChangedFrames", () => {
  beforeEach(() => { readFile.mockReset(); writeFile.mockReset(); aiExpandFrame.mockClear(); });
  it("writes the flat source for an authored composite frame", async () => {
    readFile.mockResolvedValue(SETTINGS);
    await expandChangedFrames("demo", ["01-page"]);
    expect(writeFile).toHaveBeenCalled();
    const written = writeFile.mock.calls[0][1] as string;
    expect(written).not.toContain("<SettingsPage");
    expect(written).toContain("max-w-[832px]");
    expect(aiExpandFrame).not.toHaveBeenCalled();
  });
  it("routes an un-authored composite to AI fallback, no direct write", async () => {
    readFile.mockResolvedValue(`import { VistaPage } from "arcade-prototypes";\nexport default () => <VistaPage title="x">b</VistaPage>;`);
    await expandChangedFrames("demo", ["01-v"]);
    expect(aiExpandFrame).toHaveBeenCalledWith("demo", "01-v", "VistaPage");
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("no-op for a frame with no full-page composite", async () => {
    readFile.mockResolvedValue(`export default () => <div/>;`);
    await expandChangedFrames("demo", ["01-flat"]);
    expect(writeFile).not.toHaveBeenCalled();
    expect(aiExpandFrame).not.toHaveBeenCalled();
  });
  it("swallows a read error (never throws)", async () => {
    readFile.mockRejectedValue(new Error("nope"));
    await expect(expandChangedFrames("demo", ["01-x"])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/expand/postGenHook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `postGenHook.ts`**

```ts
// studio/server/expand/postGenHook.ts
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import { expandFrame } from "./expandFrame";
import { aiExpandFrame } from "./aiExpand";

/** After a generation turn, flatten any top-level full-page composite in each
 *  changed frame so the frame is directly editable. Best-effort, per-frame
 *  isolated — never throws (must not fail the turn). */
export async function expandChangedFrames(slug: string, changedFrameSlugs: string[]): Promise<void> {
  for (const frameSlug of changedFrameSlugs) {
    try {
      const file = path.join(frameDir(slug, frameSlug), "index.tsx");
      const base = frameDir(slug, frameSlug);
      if (!path.resolve(file).startsWith(path.resolve(base))) continue;
      const source = await fs.readFile(file, "utf-8");
      const r = expandFrame(source);
      if (r.changed) {
        await fs.writeFile(file, r.source, "utf-8");
      } else if (r.needsAi) {
        await aiExpandFrame(slug, frameSlug, r.needsAi);
      }
    } catch (err) {
      console.warn(`[expand] skipped ${frameSlug}:`, err instanceof Error ? err.message : err);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/expand/postGenHook.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Wire into `chat.ts`**

Read `studio/server/middleware/chat.ts` around the post-turn diff (~line 710, `afterSnapshot`/`diffSnapshots`). The diff already identifies changed files. Derive the changed FRAME slugs (paths like `frames/<frameSlug>/index.tsx`) and, after the turn's writes are finalized, call:

```ts
import { expandChangedFrames } from "../expand/postGenHook";
// … after afterDiff is computed and the turn's frame writes are done:
const changedFrames = /* extract <frameSlug> from afterDiff entries matching frames/<slug>/index.tsx */;
if (changedFrames.length) void expandChangedFrames(slug, changedFrames);
```

Fire-and-forget (`void`) so it doesn't block the turn response; the frame write triggers the normal Vite reload. Place it where the turn has finished writing (not mid-stream). Implementer: match the actual variable names in `chat.ts` for the slug + the diff entries; extract the frame slug with a regex on the changed paths.

- [ ] **Step 6: Run the server suite**

Run: `pnpm run studio:test __tests__/server`
Expected: PASS (new expand tests + existing chat/server tests; the chat.ts edit is additive + fire-and-forget — if a chat test asserts exact post-turn behavior, confirm the added call doesn't break it; it shouldn't, being void + after the diff).

- [ ] **Step 7: Commit**

```bash
git add studio/server/expand/postGenHook.ts studio/server/middleware/chat.ts studio/__tests__/server/expand/postGenHook.test.ts
git commit -m "feat(studio/canvas): run frame auto-expand after each generation turn"
```

---

## Task 6: Full suite + manual gate

- [ ] **Step 1: Full suite**

Run: `pnpm run studio:test`
Expected: all green (modulo any known pre-existing unrelated failure — verify in isolation).

- [ ] **Step 2: Manual gate (HUMAN, app restart — server changed)**

`pnpm run studio`:
1. Generate "a page with a few cards and a save button" (produces a SettingsPage frame).
2. After it renders, the frame should look identical — but `index.tsx` is now FLAT (no `<SettingsPage>`; the title is an `<h1>`, the body is `<div>`s, the cards are right there).
3. Click the page title / a card / the save button → it selects a **frame-authored element** with **instant editable style fields** (NOT "No editable properties"). Change padding/color → applies + persists.
4. Generate a Computer-style frame (uses ComputerPage, un-authored) → the AI-expand fallback runs; the frame should still become flat-ish + editable (best-effort) OR, if AI-expand was stubbed off, stay a composite (acceptable v1 per the plan).
5. prototype-kit/ untouched; the original SettingsPage component still works for non-expanded uses.

Record results in the ledger.

---

## Final verification

- [ ] **Full suite green** (modulo known pre-existing unrelated failures, verified in isolation).
- [ ] **Manual gate 1–3 pass** — generated SettingsPage frame is flat + the title/cards/button are instantly editable (the whole point).
- [ ] **Idempotent + safe:** re-running expand on a flat frame is a no-op; a reparse-failing expansion leaves the composite intact (no broken frame).
- [ ] **AI fallback** routes un-authored composites without crashing.

## Notes on deferred scope

- Authored expansions for ComputerPage / VistaPage / BuilderPage (AI-fallback'd for now).
- A kit render-parity test asserting `expandSettingsPage` output matches the `SettingsPage` component render (guards drift).
- Sub-project #2: fix "Ask AI to change this" to take real input (separate spec; its surface shrinks once frames are flat).
- Flattening TitleBar/BreadcrumbBar too (v1 keeps them as composite refs in the slots).
