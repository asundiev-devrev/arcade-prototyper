# Arcade Recognition + Hand-Roll Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognise more of the Arcade design-system slice as real `arcade-gen` components in Figma imports, fix a cross-generation mislabel bug, and honestly tell the user which base elements were hand-rolled as static (non-transferable) pixels.

**Architecture:** Extends the deterministic kit-emit engine (`studio/server/figma/`). Each new component = a `SET_KEY_TO_KIT` row (Arcade `[0.3]` published set key) + a bespoke `emit()` case that renders the real `arcade-gen` component with its props. Recognition stays 100%-certain key matching; unmatched instances stay pixel-faithful floor. A coverage summary already computed for the console is promoted into the user-facing chat trailer, reframed as transferability. No cross-generation mapping, no shape-guessing, no vision judge.

**Tech Stack:** TypeScript, Node, Vitest. `figmanage` CLI (headless via `node node_modules/figmanage/dist/index.js`). `@xorkavi/arcade-gen` component library.

## Global Constraints

- Package manager is **pnpm**. Full suite: `pnpm run studio:test` (~90s). Single file: `pnpm run studio:test <path>`.
- **Never map across generations.** Only Arcade `[0.3]` published set keys go into `SET_KEY_TO_KIT`. Never map a DLS / deprecated / other-library key or a set matched only by a generic name.
- **A mapped kit name MUST have an `emit()` case.** A `SET_KEY_TO_KIT` row whose kit name hits the `switch` `default` branch backs out the match (`matchedInstances--`, `kitEmit.ts:1162-1167`) and renders a static div — so a row without a case is worse than useless (it silently fails while looking done). Every new row in this plan ships with its case in the same task.
- **Never emit a compound namespace object as a bare element.** Names in `NON_RENDERABLE_KIT_EXPORTS` (`kitMappings.ts:242-246`: Accordion, Breadcrumb, Chart, Dropdown, Menu, Modal, Popover, Radio, ResizablePanel, Select, Sidebar, Table, Tabs, Toast, ToggleGroup, Widget) crash the frame as `<X/>`. Compounds are emitted via dotted sub-components (`<Tabs.Root>…`) or left to the floor.
- **Verify every twin exists in the real barrel before mapping to it.** Barrel export list is parsed in `studio/server/figma/kitBarrel.ts`; the resolved d.mts is at `node_modules/.pnpm/@xorkavi+arcade-gen@*/node_modules/@xorkavi/arcade-gen/dist/index.d.mts`. `NumberField` and `SegmentedControl` do NOT exist → never map to them.
- Every bug/behavior gets a test (`__tests__/server/figma/*`). Commit after each green task.

---

## Task 0: Harvest the Arcade `[0.3]` set keys (data-gathering, no code ship)

**Files:**
- Create: `studio/tmp/ads-03-keys.md` (scratch notes — NOT committed; feeds Tasks 2–4)

**Interfaces:**
- Produces: a verified list of `{ ADS set name → published componentSetKey → arcade-gen twin OR "no twin/floor" }` for the Arcade `[0.3]` generation, used to author `SET_KEY_TO_KIT` rows in later tasks.

- [ ] **Step 1: Enumerate the ADS `[0.3]` sets**

The ADS file key is `a2uKnm88LxRXEWAL1kOqeQ`. Run:

```bash
node node_modules/figmanage/dist/index.js components list-file-components a2uKnm88LxRXEWAL1kOqeQ --json > studio/tmp/ads-components.json
```

Expected: exit 0, a JSON array of ~5000+ components. Each component's set membership is under **`containing_frame.containingStateGroup`** (Figma's REST field name for the component-set; `.nodeId` is the SET node id, e.g. `"4361:9072"`, `.name` is the set name, e.g. `"Inline Banner"`). The `[0.3]` generation label lives on `containing_frame.pageName` (e.g. `"⁠Banners [DLS · 0.3]"`), not the set name — filter by page to find the `[0.3]` sets. (Verified 2026-07-09: this is the real shape; do NOT expect a `containingComponentSet` field.)

- [ ] **Step 2: For each target `[0.3]` set, resolve its published SET key**

`list-file-components` returns *component* keys, not *set* keys. `SET_KEY_TO_KIT` is keyed on the **set** key. Resolve it by fetching the set node — its key lives in the response's `componentSets` map (verified 2026-07-09: set `4361:9072` "Inline Banner" → key `edf96535be2abc8d0b836f54d450d60683a896ab`):

```bash
node node_modules/figmanage/dist/index.js reading get-nodes a2uKnm88LxRXEWAL1kOqeQ <SET_NODE_ID> --depth 0 --json
```

Read `.nodes["<SET_NODE_ID>"].componentSets["<SET_NODE_ID>"].key`. Do this for each candidate set below.

- [ ] **Step 3: Record the mapping table in `studio/tmp/ads-03-keys.md`**

Candidate `[0.3]` sets and their arcade-gen twins (twin existence pre-checked against the barrel). Fill the set key column from Step 2:

| ADS `[0.3]` set | arcade-gen twin | Route |
|---|---|---|
| Banners `[0.3]` (Inline Banner) | `Banner` | emit case (Task 2) |
| Text Area `[0.3]` | `TextArea` | emit case (Task 2) |
| Links `[0.3]` | `Link` | emit case (Task 2) |
| Shortcut `[0.3]` | `KeyboardShortcut` | emit case (Task 3) |
| Split Button `[0.3]` | `SplitButton` (+ `SplitButtonItem`) | emit case (Task 3) |
| Number Field `[0.3]` | — (no twin) | FLOOR — do not map |
| Segmented Control `[0.3]` | — (no twin) | FLOOR — do not map |
| Accordion `[0.3]` | `Accordion` (compound) | FLOOR unless usage justifies sub-component case |
| Selectors `[0.3]` | `Radio`/`Checkbox` (compound `Radio`) | FLOOR / Checkbox already mapped |

- [ ] **Step 4: Confirm each twin is a renderable export (not a compound), from the barrel**

```bash
DTS=$(node -e "console.log(require.resolve('@xorkavi/arcade-gen').replace(/index\.cjs$/,'index.d.mts'))")
grep -oE "declare (const|function) (Banner|TextArea|Link|KeyboardShortcut|SplitButton|SplitButtonItem)\b" "$DTS" | sort -u
```

Expected: all six present. Confirm none are in `NON_RENDERABLE_KIT_EXPORTS` (`kitMappings.ts:242`). `Banner`, `TextArea`, `Link`, `KeyboardShortcut`, `SplitButton`, `SplitButtonItem` are all plain renderables. No commit (scratch only).

---

## Task 1: Fix the cross-generation mislabel hole in the name tier

**Files:**
- Modify: `studio/server/figma/kitMappings.ts:53-62` (`SET_NAME_TO_KIT`)
- Test: `studio/__tests__/server/figma/kitMappings.test.ts` (create if absent; else add to existing)

**Interfaces:**
- Consumes: `matchKit(setKey, setName)` (`kitMappings.ts:253`).
- Produces: unchanged signature; behavior change — a non-Arcade set named `"Button"` no longer resolves to a kit component by name.

**Context:** `SET_NAME_TO_KIT["Button"] = "Button"` (`kitMappings.ts:61`) matches ANY set whose name is `"Button"` — including deprecated/DLS/product sets — and emits an arcade-gen `<Button>`. That is the exact cross-generation mislabel the whole design forbids. Key-tier matching (tier 1, the certain path) is unaffected; only this loose generic name entry is the risk. The generic entries `Button`, `Avatar` are removed; specific/safe icon-ish and pseudo entries (`Account Avatar`, `Images`, `User avatars`, `Avatar Group`, `Ghost Button`, `Icon Button`) stay — they are either pseudo-kit routes or icon-adjacent names unlikely to collide with a foreign generic frame.

**Accepted trade-off (state it, don't hide it):** removing the `Avatar` name entry means a genuinely-detached Arcade Avatar copy (no key, named just "Avatar") now falls to the pixel-faithful floor instead of a kit `<Avatar>`. Correct precision call — a bare "Avatar" name can't be proven Arcade-generation — but a small recall loss for detached avatars, identical in kind to the Button case. Detached copies that keep a component link still resolve by key.

- [ ] **Step 1: Write the failing test**

```typescript
// studio/__tests__/server/figma/kitMappings.test.ts
import { describe, it, expect } from "vitest";
import { matchKit } from "../../../server/figma/kitMappings";

describe("matchKit cross-generation guard", () => {
  it("does NOT map a set matched only by the generic name 'Button' (could be DLS/deprecated)", () => {
    // No key match; name is the generic 'Button'. Must NOT resolve to a kit component.
    expect(matchKit(undefined, "Button")).toBeNull();
  });

  it("still maps a real Arcade Button by its published set key", () => {
    // The canonical Arcade [0.3] Button key stays mapped via SET_KEY_TO_KIT.
    expect(matchKit("0b87fe4f9790e1c0053da61c767edbaa1c46826d", "Button")).toEqual({
      kind: "component",
      kit: "Button",
    });
  });

  it("still maps detached Icon Button by name (kept — icon-adjacent, low collision risk)", () => {
    expect(matchKit(undefined, "Icon Button")).toEqual({ kind: "component", kit: "IconButton" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/figma/kitMappings.test.ts`
Expected: FAIL — the first case returns `{ kind: "component", kit: "Button" }` (not null) because `SET_NAME_TO_KIT["Button"]` still matches.

- [ ] **Step 3: Remove the generic entries from `SET_NAME_TO_KIT`**

In `studio/server/figma/kitMappings.ts`, edit the `SET_NAME_TO_KIT` object (lines 53-62). Delete the `Button: "Button"` and `Avatar: "Avatar"` lines. Keep the rest. Add a comment noting why:

```typescript
export const SET_NAME_TO_KIT: Record<string, string> = {
  // NOTE: generic single-word names ("Button", "Avatar") are DELIBERATELY NOT
  // here. Matching a bare "Button" set name maps ANY generation's Button
  // (incl. deprecated/DLS) to arcade-gen — a cross-generation mislabel that
  // ships wrong production code. Arcade Buttons/Avatars resolve by KEY
  // (SET_KEY_TO_KIT), which is certain. Only keep names that are pseudo-kit
  // routes or icon-adjacent and unlikely to collide.
  "Account Avatar": "AccountAvatar",
  Images: "ImageAvatar",
  "User avatars": "ImageAvatar",
  "Avatar Group": "AvatarGroup",
  "Ghost Button": "IconButton",
  "Icon Button": "IconButton",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/figma/kitMappings.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Fix the pre-existing name-tier test that this breaks**

Removing `SET_NAME_TO_KIT["Avatar"]` breaks a real test — `kitEmit.test.ts:86-88`:

```typescript
  it("falls back to set-name matching for detached copies", () => {
    expect(matchKit("unknown-key", "Avatar")).toEqual({ kind: "component", kit: "Avatar" });
  });
```

This test exercises the name-tier fallback *mechanism* — do NOT delete it or convert it to a key match (that erases tier coverage). Instead repoint the example to a name we KEPT, so the mechanism is still tested:

```typescript
  it("falls back to set-name matching for detached copies", () => {
    expect(matchKit("unknown-key", "Icon Button")).toEqual({ kind: "component", kit: "IconButton" });
  });
```

- [ ] **Step 6: Run the full figma suite to catch remaining fallout**

Run: `pnpm run studio:test studio/__tests__/server/figma`
Expected: PASS. If any OTHER test relied on name-matching a bare `"Button"`/`"Avatar"`, repoint it to a kept name too (grep `matchKit(.*"Button"` / `"Avatar"` in the test dir).

- [ ] **Step 7: Commit**

```bash
git add studio/server/figma/kitMappings.ts studio/__tests__/server/figma/kitMappings.test.ts studio/__tests__/server/figma/kitEmit.test.ts
git commit -m "fix(studio/figma): drop generic name-tier Button/Avatar match (cross-generation mislabel)"
```

---

## Task 2: Add emit cases — Banner, TextArea, Link (single-element twins)

**Files:**
- Modify: `studio/server/figma/kitMappings.ts` (`SET_KEY_TO_KIT` — 3 new rows)
- Modify: `studio/server/figma/kitEmit.ts` (3 new `case` blocks in the `emit()` switch, after the `Breadcrumb` case ~line 1081)
- Test: `studio/__tests__/server/figma/kitEmit.test.ts` (add cases)

**Interfaces:**
- Consumes: `matchKit` (returns `{kind:"component", kit:"Banner"|"TextArea"|"Link"}`); emit helpers already in scope in `emit()`: `usedKit` (Set), `kitInstanceCount` (counter), `centerBox(n,px,py,flex)`, `sx(style)`, `pad`, `visibleTexts(n)`, `escText(s)`, `instanceProps(n)` → `p`.
- Produces: three renderable kit components in generated frames; `usedKit` gains `Banner`/`TextArea`/`Link`.

**Context:** Pattern is identical to the existing `Input`/`Badge`/`Tag` cases (`kitEmit.ts:1028-1106`): add `usedKit.add(...)`, `kitInstanceCount++`, pull text via `visibleTexts`, push a `<div style=...>...</div>` line. Set keys come from Task 0. Barrel signatures (verified): `Banner` takes `title`/children + `intent`; `TextArea` is an input-like forwardRef; `Link` wraps children with `href`.

- [ ] **Step 1: Write the failing tests**

Add to `studio/__tests__/server/figma/kitEmit.test.ts`. There is **no** `emitFixtureInstance` helper — use the file's real idiom: build a `frameNode(...)` with an `INSTANCE` child + `components`/`componentSets` maps, call `emitKitFrame(doc, {components, componentSets, assetFiles: new Map()})`, read `r.source`. Copy the exact shape from the existing `checkboxInstance`/`checkboxMaps`/`emitKitFrame` tests (`kitEmit.test.ts:37-57, 168-179`). Add one small local factory to avoid repetition:

```typescript
// A text INSTANCE whose set resolves (via componentSetId) to `setKey`/`setName`,
// with `label` as a visible TEXT child. Mirrors checkboxInstance/checkboxMaps.
function kitTextInstance(id: string, setKey: string, setName: string, label: string) {
  const doc = frameNode("0", [{
    id, type: "INSTANCE", componentId: `c:${id}`,
    absoluteBoundingBox: bbox(10, 10, 200, 40),
    children: [{ id: `${id}-t`, type: "TEXT", characters: label, absoluteBoundingBox: bbox(12, 12, 180, 20) }],
  }]);
  const maps = {
    components: { [`c:${id}`]: { key: "v", name: `${setName} variant`, componentSetId: `s:${id}` } },
    componentSets: { [`s:${id}`]: { key: setKey, name: setName } },
    assetFiles: new Map(),
  };
  return emitKitFrame(doc, maps);
}

describe("emit — Banner/TextArea/Link", () => {
  it("emits a Banner with the text as CHILDREN (inline layout ignores title)", () => {
    const r = kitTextInstance("b1", BANNER_SET_KEY, "Inline Banner", "Heads up: SLA at risk");
    expect(r.source).toContain("<Banner");
    // C2 guard: text must be the child, NOT in a title="" prop (inline drops title)
    expect(r.source).toContain(">Heads up: SLA at risk</Banner>");
    expect(r.source).not.toMatch(/title="Heads up/);
    expect(r.kitImports).toContain("Banner");
  });

  it("emits a TextArea with defaultValue", () => {
    const r = kitTextInstance("t1", TEXTAREA_SET_KEY, "Text Area", "Notes");
    expect(r.source).toContain("<TextArea");
    expect(r.source).toContain('defaultValue="Notes"');
    expect(r.kitImports).toContain("TextArea");
  });

  it("emits a Link with href and label", () => {
    const r = kitTextInstance("l1", LINK_SET_KEY, "Links", "View ticket");
    expect(r.source).toContain('<Link href="#">View ticket</Link>');
    expect(r.kitImports).toContain("Link");
  });
});
```

Replace `BANNER_SET_KEY`/`TEXTAREA_SET_KEY`/`LINK_SET_KEY` with the real keys harvested in Task 0 (declare them as `const` at the top of the describe block).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/figma/kitEmit.test.ts`
Expected: FAIL — no `<Banner>`/`<TextArea>`/`<Link>` (the sets aren't mapped; they render as divs).

- [ ] **Step 3: Add the `SET_KEY_TO_KIT` rows**

In `kitMappings.ts` `SET_KEY_TO_KIT`, add (using the real keys from Task 0):

```typescript
  "<BANNER_SET_KEY>": "Banner",     // 0.3 "Inline Banner"
  "<TEXTAREA_SET_KEY>": "TextArea", // 0.3 "Text Area"
  "<LINK_SET_KEY>": "Link",         // 0.3 "Links"
```

- [ ] **Step 4: Add the emit cases**

In `kitEmit.ts`, after the `Breadcrumb` case (ends ~line 1081), add:

```typescript
        case "Banner": {
          // REAL API (verified against index.d.mts:2092): `children: ReactNode` is
          // REQUIRED; `title` is ONLY used for layout="section" (default is
          // "inline", and the ADS set we map is literally "Inline Banner"). So ALL
          // text goes into children — putting the primary text in `title` renders
          // an EMPTY inline banner. `intent` ∈ BannerIntent; reuse the Tag intent
          // map (neutral/alert/success/warning/info/intelligence) if present.
          usedKit.add("Banner");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const body = texts.join(" ");
          const intent = TAG_INTENT_MAP[p.Type ?? p.Intent ?? ""];
          const ia = intent ? ` intent="${intent}"` : "";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><Banner${ia}>${escText(body)}</Banner></div>`);
          return;
        }
        case "TextArea": {
          usedKit.add("TextArea");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const value = texts[0];
          const attrs = value
            ? `defaultValue=${JSON.stringify(value)}`
            : `placeholder=${JSON.stringify("")}`;
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><TextArea ${attrs} /></div>`);
          return;
        }
        case "Link": {
          usedKit.add("Link");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim());
          const label = texts[0] ?? "Link";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><Link href="#">${escText(label)}</Link></div>`);
          return;
        }
```

Signatures are already verified against `index.d.mts` (BannerProps:2092, KeyboardShortcutProps:2253, and TextArea/Link extend textarea/anchor attrs so `defaultValue`/`placeholder`/`href` are real). Do NOT re-invent props.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/figma/kitEmit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/server/figma/kitMappings.ts studio/server/figma/kitEmit.ts studio/__tests__/server/figma/kitEmit.test.ts
git commit -m "feat(studio/figma): recognise Arcade Banner/TextArea/Link as kit components"
```

---

## Task 3: Add emit cases — KeyboardShortcut, SplitButton

**Files:**
- Modify: `studio/server/figma/kitMappings.ts` (`SET_KEY_TO_KIT` — 2 new rows)
- Modify: `studio/server/figma/kitEmit.ts` (2 new `case` blocks)
- Test: `studio/__tests__/server/figma/kitEmit.test.ts`

**Interfaces:**
- Consumes: same emit helpers as Task 2; additionally `SplitButton` composes `SplitButtonItem` children.
- Produces: `KeyboardShortcut`, `SplitButton` (+ `SplitButtonItem`) recognised.

**Context:** `SplitButton` is a renderable that expects `SplitButtonItem` children (verified present in the barrel; NOT in `NON_RENDERABLE_KIT_EXPORTS`). `KeyboardShortcut` renders key labels. Keep these in their own task because SplitButton needs child synthesis (a reviewer could reasonably reject the child logic while approving Task 2's simple twins).

- [ ] **Step 1: Write the failing tests**

Reuse the `kitTextInstance` factory from Task 2. Assert the REAL prop form, not just the tag (this is what catches the C1 white-screen — a bare `<KeyboardShortcut>` would pass a tag-only check but crash at render):

```typescript
describe("emit — KeyboardShortcut/SplitButton", () => {
  it("emits KeyboardShortcut with a keys={[]} prop (NEVER children — children crash it)", () => {
    const r = kitTextInstance("k1", SHORTCUT_SET_KEY, "Shortcut", "⌘K");
    expect(r.source).toContain("<KeyboardShortcut keys={");
    // C1 guard: must NOT emit text as children (keys.map on undefined → white-screen)
    expect(r.source).not.toMatch(/<KeyboardShortcut>[^<]/);
    expect(r.kitImports).toContain("KeyboardShortcut");
  });
  it("emits a SplitButton wrapping a SplitButtonItem label", () => {
    const r = kitTextInstance("sb1", SPLITBUTTON_SET_KEY, "Split Button", "Save");
    expect(r.source).toContain("<SplitButton>");
    expect(r.source).toContain("<SplitButtonItem>Save</SplitButtonItem>");
    expect(r.kitImports).toContain("SplitButton");
  });
});
```

Declare `SHORTCUT_SET_KEY`/`SPLITBUTTON_SET_KEY` from Task 0.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/figma/kitEmit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the `SET_KEY_TO_KIT` rows**

```typescript
  "<SHORTCUT_SET_KEY>": "KeyboardShortcut", // 0.3 "Shortcut"
  "<SPLITBUTTON_SET_KEY>": "SplitButton",   // 0.3 "Split Button"
```

- [ ] **Step 4: Add the emit cases**

```typescript
        case "KeyboardShortcut": {
          // REAL API (verified against index.d.mts:2253): `keys: string[]` is
          // REQUIRED and the body calls keys.map(); CHILDREN ARE IGNORED. Passing
          // text as children (with no `keys`) → keys.map on undefined → runtime
          // TypeError → WHITE-SCREEN (esbuild frames aren't type-checked). So we
          // MUST split the combo into a keys array and pass it as a prop.
          usedKit.add("KeyboardShortcut");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim());
          const combo = texts[0] ?? "⌘K";
          // Split on common separators (⌘K, "Cmd K", "Ctrl+Shift+P") into labels.
          const keys = combo.split(/[\s+]+/).flatMap((seg) =>
            // keep multi-char words whole; split bare glyph runs like "⌘K" into ⌘,K
            /^[\w-]+$/.test(seg) ? [seg] : Array.from(seg),
          ).filter(Boolean);
          const keysArr = keys.length ? keys : [combo];
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><KeyboardShortcut keys={${JSON.stringify(keysArr)}} /></div>`);
          return;
        }
        case "SplitButton": {
          usedKit.add("SplitButton");
          usedKit.add("SplitButtonItem");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const label = texts[0] ?? "Action";
          // SplitButton composes SplitButtonItem children; emit the primary item.
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><SplitButton><SplitButtonItem>${escText(label)}</SplitButtonItem></SplitButton></div>`);
          return;
        }
```

Verified: `SplitButtonItem` renders `children` as its label and `SplitButton` provides the context it reads (index.d.mts SplitButtonProps/SplitButtonItemProps) — the JSX above is correct as written. `KeyboardShortcut` uses the `keys={[]}` prop form (see its case) — never children.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/figma/kitEmit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/server/figma/kitMappings.ts studio/server/figma/kitEmit.ts studio/__tests__/server/figma/kitEmit.test.ts
git commit -m "feat(studio/figma): recognise Arcade KeyboardShortcut/SplitButton as kit components"
```

---

## Task 4: Guard test — no mapped kit name lacks an emit case, no compound is bare-emittable

**Files:**
- Test: `studio/__tests__/server/figma/kit-mapping-hygiene.test.ts` (create)

**Interfaces:**
- Consumes: `SET_KEY_TO_KIT`, `SET_NAME_TO_KIT`, `NON_RENDERABLE_KIT_EXPORTS` (`kitMappings.ts`); the set of `case` labels in `kitEmit.ts`'s `emit()` switch.
- Produces: a regression guard so future rows can't silently fall through to `default` (the "row without a case" trap the Global Constraints call out).

**Context:** This is the guard that makes the whole plan safe to extend. It asserts every kit name a mapping can produce is either an emitted `case`, an icon, or a pseudo-kit route — never a bare compound. It reads `kitEmit.ts` source text for `case "X":` labels (the switch is a stable, greppable structure).

- [ ] **Step 1: Write the test**

```typescript
// studio/__tests__/server/figma/kit-mapping-hygiene.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SET_KEY_TO_KIT,
  SET_NAME_TO_KIT,
  PSEUDO_KIT_RENDERS,
  NON_RENDERABLE_KIT_EXPORTS,
} from "../../../server/figma/kitMappings";

const emitSrc = readFileSync(
  fileURLToPath(new URL("../../../server/figma/kitEmit.ts", import.meta.url)),
  "utf-8",
);
const emittedCases = new Set(
  [...emitSrc.matchAll(/case\s+"([A-Za-z]+)":/g)].map((m) => m[1]),
);

describe("kit mapping hygiene", () => {
  it("every component-mapped kit name has an emit case or a pseudo-kit route", () => {
    const names = new Set<string>([
      ...Object.values(SET_KEY_TO_KIT),
      ...Object.values(SET_NAME_TO_KIT),
    ]);
    for (const name of names) {
      const ok = emittedCases.has(name) || name in PSEUDO_KIT_RENDERS;
      expect(ok, `"${name}" is mapped but has no emit case (would fall to default → static div)`).toBe(true);
    }
  });

  it("no component-mapped kit name is a bare compound namespace object", () => {
    for (const name of Object.values(SET_KEY_TO_KIT)) {
      // Compounds may only appear as dotted sub-components; a bare mapping to one
      // means the emit case must use <Name.Sub/>, never <Name/>. Enforce that any
      // such name is NOT emitted bare.
      if (NON_RENDERABLE_KIT_EXPORTS.has(name)) {
        const bare = new RegExp(`<${name}\\s*[/>]`);
        expect(bare.test(emitSrc), `<${name}/> emitted bare — will white-screen`).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm run studio:test studio/__tests__/server/figma/kit-mapping-hygiene.test.ts`
Expected: PASS (Tasks 2–3 added cases for every new row; existing rows already have cases). If it FAILS, a row was added without a case — add the case or remove the row.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/server/figma/kit-mapping-hygiene.test.ts
git commit -m "test(studio/figma): guard — mapped kit names must have an emit case, no bare compounds"
```

---

## Task 5: Promote coverage into the user trailer as a transferability notice

**Files:**
- Modify: `studio/server/figma/kitEmitBranch.ts` (add a formatter + weave into the trailer at ~line 414-420)
- Test: `studio/__tests__/server/figma/kitEmitBranch.test.ts` (add cases for the new formatter)

**Interfaces:**
- Consumes: `EmitResult` (`{ totalInstances, matchedInstances, unmatchedSets, kitInstanceCount, kitImports }`); existing `formatCoverage` (`kitEmitBranch.ts:150`).
- Produces: `formatHandRollNotice(result): string` — a user-facing line naming how many components were recognised vs rendered as static pixels + the top unmatched set names; woven into the non-sub-import trailer.

**Context:** `formatCoverage` already exists and is console-only (`kitEmitBranch.ts:396`). The user trailer is built at `kitEmitBranch.ts:414-420` and emitted via `narrate(trailer)`. Sub-imports return early at line 410-412 (no trailer) — leave that path untouched. Only INSTANCE nodes populate `unmatchedSets`/`totalInstances` (`kitEmit.ts:946-952`), so layout frames/text are excluded by construction — "bar the layout" holds for free.

- [ ] **Step 1: Write the failing test**

```typescript
// add to studio/__tests__/server/figma/kitEmitBranch.test.ts
import { formatHandRollNotice } from "../../../server/figma/kitEmitBranch";

describe("formatHandRollNotice", () => {
  it("names recognised count and the static (non-transferable) unmatched sets", () => {
    const line = formatHandRollNotice({
      totalInstances: 20,
      matchedInstances: 8,
      unmatchedSets: { Card: 5, Reaction: 4, Toolbar: 3 },
    });
    expect(line).toContain("8"); // recognised
    expect(line).toContain("static"); // transferability framing
    expect(line).toContain("Card");
    expect(line).toContain("Reaction");
  });

  it("says everything transferred when nothing is unmatched", () => {
    const line = formatHandRollNotice({ totalInstances: 5, matchedInstances: 5, unmatchedSets: {} });
    expect(line.toLowerCase()).toContain("all");
    expect(line).not.toContain("static");
  });

  it("handles a zero-instance frame without dividing by zero", () => {
    const line = formatHandRollNotice({ totalInstances: 0, matchedInstances: 0, unmatchedSets: {} });
    expect(typeof line).toBe("string");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/figma/kitEmitBranch.test.ts`
Expected: FAIL — `formatHandRollNotice` is not exported.

- [ ] **Step 3: Implement `formatHandRollNotice`**

In `kitEmitBranch.ts`, next to `formatCoverage` (after line 162):

```typescript
/**
 * User-facing transferability notice. Recognised (real design-system) components
 * translate to production code; unmatched INSTANCES are rendered as faithful but
 * STATIC pixels that won't. Only INSTANCE nodes reach unmatchedSets (kitEmit.ts),
 * so layout frames/text are excluded — this is about placed components, not layout.
 */
export function formatHandRollNotice(
  result: { totalInstances: number; matchedInstances: number; unmatchedSets: Record<string, number> },
  topN = 4,
): string {
  const { totalInstances, matchedInstances, unmatchedSets } = result;
  const unmatchedCount = totalInstances - matchedInstances;
  if (totalInstances === 0) {
    return "No design-system components detected — this frame is custom layout and text.";
  }
  if (unmatchedCount <= 0) {
    return `All ${matchedInstances} design-system components were recognised and will transfer to production code.`;
  }
  const top = Object.entries(unmatchedSets)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([name, count]) => `${name} ×${count}`);
  const list = top.length ? ` (${top.join(", ")})` : "";
  return (
    `Recognised ${matchedInstances} design-system component${matchedInstances === 1 ? "" : "s"}. ` +
    `${unmatchedCount} element${unmatchedCount === 1 ? "" : "s"} rendered as static pixels that won't transfer to production${list}. ` +
    `Swap them to Arcade design-system components in Figma to make them real code.`
  );
}
```

- [ ] **Step 4: Weave into the trailer**

Replace the trailer construction at `kitEmitBranch.ts:414-420`. **Do NOT keep the old "N elements are real kit components" sentence alongside the notice** — that sentence uses `kitInstanceCount` while the notice uses `matchedInstances`, and per the `EmitResult` docstring (`kitEmit.ts:844-846`) those two counts differ (kitInstanceCount also counts derived sub-instances + icons), so keeping both prints two different "real component" numbers in one paragraph. Let `formatHandRollNotice` own the count; keep the component-name list on the old line:

```typescript
  const compNames = result.kitImports.join(", ");
  const named = compNames ? ` (${compNames})` : "";
  const trailer =
    `Imported from Figma with exact geometry. ` +
    `${formatHandRollNotice(result)}${named} ` +
    "Unmatched elements are faithful static markup with locally exported assets. " +
    "Tell me what to change or which interactions to wire next.";
  narrate(trailer);
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/figma/kitEmitBranch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/server/figma/kitEmitBranch.ts studio/__tests__/server/figma/kitEmitBranch.test.ts
git commit -m "feat(studio/figma): surface hand-roll transferability notice in the import trailer"
```

---

## Task 6: Full suite + manual acceptance on the real nav screen

**Files:** none (verification only)

- [ ] **Step 1: Full suite green**

Run: `pnpm run studio:test`
Expected: PASS (no regressions).

- [ ] **Step 2: Manual acceptance — real import**

Start Studio (`pnpm run studio`, browser opens on :5556). In a project, prompt: `Implement this design precisely: https://www.figma.com/design/JztJjqt3i6uFwB6r4dfewz/Navigation--where-to-next?node-id=328-14859`

Confirm:
- The trailer shows the transferability notice: "Recognised N design-system components. M elements rendered as static pixels…" with real set names.
- Any Arcade Banner/TextArea/Link/Shortcut/SplitButton present render as real components (spot-check the frame `index.tsx` for `<Banner`/`<TextArea`/etc.).
- No deprecated/DLS `<Button>` set was silently upgraded to an arcade-gen Button (it should remain a faithful div — grep the frame source).
- The frame renders without a white-screen (no bare compound emitted).

- [ ] **Step 3: Remove scratch**

```bash
rm -f studio/tmp/ads-components.json studio/tmp/ads-03-keys.md
```

- [ ] **Step 4: Final commit (if any doc/changelog touched)**

No version bump required (per project convention, fixes test locally without a DMG bump unless a release is requested). If you added a CHANGELOG entry, commit it; otherwise nothing to do.

---

## Self-review notes (author)

- **Spec coverage:** WS1 recognition = Tasks 0,2,3 (+ guard Task 4); precision fix = Task 1; WS2 notification = Task 5; manual gate = Task 6. All spec sections covered.
- **Dropped items honored:** no Arcade-recall %, no sync-ads auto-enumerate (Task 0 is manual harvest), no leaves bucket, no floor-hardening, no DLS mapping.
- **Type consistency:** `formatHandRollNotice` result shape matches `formatCoverage`'s (`{totalInstances,matchedInstances,unmatchedSets}`), both subsets of `EmitResult`. Emit cases reuse the exact helpers present in `emit()` scope (`usedKit`, `kitInstanceCount`, `centerBox`, `sx`, `pad`, `visibleTexts`, `escText`, `p`).
- **Known risk carried:** the emit-case JSX for Banner/SplitButton is written to the expected barrel API; Step 4 of Tasks 2–3 instructs verifying the real d.mts signature before finalizing (tests assert tag presence, tolerant of prop tweaks).
