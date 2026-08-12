#!/usr/bin/env node
// PostToolUse hook: block a BOUNDED denylist of invented props / wrong value
// shapes on kit components at write time, so the agent self-corrects in the
// same turn instead of reporting a false success ("changed to multi-select,
// Deviations: None") over an unchanged-or-broken frame.
//
// Seeded from the confirmed repro: `<Select.Root multiple defaultValue={["x"]}>`.
// arcade-gen's Select is Radix-based — NO `multiple` prop, and `value`/
// `defaultValue` are STRINGS (not arrays). The `multiple` was silently ignored
// (no multi-select happened) and the array `defaultValue` broke that Select.
//
// This is NOT a general prop typechecker (that's the render-verify keystone).
// It catches a small, verified set of false-success classes and grows by
// adding components to the sets below — same shape as validateArcadeImports's
// barrel and validateTokenClasses's allowlist.
//
// Mirrors validateArcadeImports.mjs: pure-function exports for tests + a
// main() that reads stdin and exits 0 (ok) or 2 (block). Fails open on any
// parse/runtime error — a broken hook must never wedge a real generation.

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript"; // direct studio dep; default import yields the module namespace

// LOCKED type facts (verified vs the real Radix types in arcade-gen 2.0.0 —
// do NOT lump):
//   Select (react-select) / Tabs (react-tabs): string-only value/defaultValue;
//     NO `multiple` prop. Multi-value lives in MultiSelect / Combobox instead.
//   SegmentedControl / Accordion (react-toggle-group / -accordion): a
//     discriminated union on `type` — type="single" → string, type="multiple"
//     → string[]. NO boolean `multiple` prop; multi-select is type="multiple".
//
// NOTE on the name: in arcade-gen 1.x the segmented control was exported as
// `ToggleGroup`. 2.0 renamed it to `SegmentedControl` and reused the
// `ToggleGroup` name for an unrelated component (labelled toggle rows) that is
// NOT compound and takes `label`, not `value`. So `ToggleGroup` is deliberately
// absent from these sets — see COMPOUND_ONLY_IN_V1 below, which catches the
// stale `<ToggleGroup.Root>` shape directly.
const STRING_ONLY_COMPONENTS = new Set(["Select", "Tabs"]);
const UNION_TYPE_COMPONENTS = new Set(["SegmentedControl", "Accordion"]);
// None of the four take a boolean `multiple` prop (native <select>/<input> do,
// but those are lowercase HTML tags — never matched by kitComponentOf).
const NO_MULTIPLE_PROP = new Set(["Select", "Tabs", "SegmentedControl", "Accordion"]);

/**
 * Components that WERE compound in arcade-gen 1.x but are not in 2.x, mapped to
 * the export that carries the old shape. `<ToggleGroup.Root>` still parses and
 * still passes the import validator (the `ToggleGroup` export exists!), but
 * `ToggleGroup.Root` is `undefined` at runtime, so React throws "Element type
 * is invalid" and the frame white-screens. This is the one v1→v2 break that no
 * other guard catches, so it gets an explicit rule.
 */
const COMPOUND_ONLY_IN_V1 = new Map([["ToggleGroup", "SegmentedControl"]]);

/**
 * Exports that are RENDERABLE components carrying sub-parts — `declare const X:
 * ForwardRefExoticComponent<…> & { Item: … }` — plus `SplitButton`, which has no
 * sub-parts at all. None of them has a `.Root`, so `<X.Root>` is `undefined` and
 * white-screens the frame exactly like `<ToggleGroup.Root>` does.
 *
 * `ToggleGroup` is deliberately NOT here: it belongs to the same class but gets
 * the richer v1→v2 migration message from COMPOUND_ONLY_IN_V1 above.
 *
 * Values are the correct shape to write instead. Kept as a short literal map
 * rather than parsed from the barrel because this hook runs on every Write and
 * must stay cheap; __tests__/templates/claude-md-component-names.test.ts asserts
 * the underlying facts against arcade-gen's shipped type declarations, so a kit
 * bump that makes any of these compound fails there.
 */
const NO_ROOT_SUBPART = new Map([
  [
    "SplitButton",
    '<SplitButton variant="primary"> with <SplitButtonItem> children (SplitButtonItem is its own top-level import, not SplitButton.Item)',
  ],
  ["Card", "<Card> directly — its sub-parts are Card.Connector / Card.Skill / Card.File / Card.Image"],
  ["CardRadioSelect", "<CardRadioSelect> directly, with <CardRadioSelect.Item> children"],
  ["Grid", "<Grid> directly, with <Grid.Item> children"],
]);

/**
 * The kit-component name for a JSX tag, or null when it's not a capitalized
 * member-expression tag. Keying on `<Name.Member>` where Name is capitalized
 * is deliberate: a native lowercase `<select multiple>` / `<input multiple>`
 * (real, valid HTML) has an Identifier tagName, not a PropertyAccessExpression,
 * so this returns null and native HTML is NEVER flagged.
 *
 * `<Select.Root>` → "Select"; `<ToggleGroup.Item>` → "ToggleGroup".
 */
export function kitComponentOf(tagNode) {
  if (
    tagNode &&
    ts.isPropertyAccessExpression(tagNode) &&
    ts.isIdentifier(tagNode.expression)
  ) {
    const name = tagNode.expression.text;
    if (name && name[0] === name[0].toUpperCase()) return name;
  }
  return null;
}

/**
 * The sub-part name of a compound tag — `<Select.Root>` → "Root",
 * `<ToggleGroup.Item>` → "Item". Null for non-member tags. Uses `.name.text`
 * for the same parentless-node reason documented on `attr()` below.
 */
export function kitSubpartOf(tagNode) {
  if (
    tagNode &&
    ts.isPropertyAccessExpression(tagNode) &&
    ts.isIdentifier(tagNode.name)
  ) {
    return tagNode.name.text;
  }
  return null;
}

/**
 * Find a JSX attribute by name on an opening element. Uses `.name.text` —
 * NEVER `.getText()`. The source file is built with setParentNodes=false
 * (below), so `.getText()` walks a null parent chain and THROWS (the `?.`
 * does NOT catch a throw); that would crash the detector, the hook would fail
 * open, and this whole guard would silently do nothing. `.text` reads the
 * identifier directly and is safe on a parentless node — the same pattern the
 * sibling validateArcadeImports.mjs relies on.
 */
function attr(openingEl, propName) {
  const props = openingEl.attributes?.properties ?? [];
  return props.find(
    (p) => ts.isJsxAttribute(p) && p.name && p.name.text === propName,
  );
}

/** True when the attribute initializer is an array literal — `prop={[ ... ]}`
 *  (a JsxExpression wrapping an ArrayLiteralExpression). */
function isArrayLiteralInitializer(a) {
  const init = a?.initializer;
  return (
    init &&
    ts.isJsxExpression(init) &&
    init.expression &&
    ts.isArrayLiteralExpression(init.expression)
  );
}

/**
 * Read the sibling `type` prop. Returns:
 *   { present:false }                    — no type= at all (treat as "single")
 *   { present:true, value:"single"|... } — a LITERAL string type
 *   { present:true, dynamic:true }       — type={x} / non-literal → SKIP gating
 * A dynamic type MUST NOT be treated as "single" — the var may resolve to
 * "multiple", so an array under it is not provably wrong (safe direction:
 * misses OK, false alarms NOT).
 */
function typeLiteral(openingEl) {
  const a = attr(openingEl, "type");
  if (!a) return { present: false, value: null, dynamic: false };
  const init = a.initializer;
  // type="single"  → StringLiteral initializer
  if (init && ts.isStringLiteral(init)) return { present: true, value: init.text, dynamic: false };
  // type={"single"} → JsxExpression wrapping a StringLiteral
  if (init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression))
    return { present: true, value: init.expression.text, dynamic: false };
  // type={mode} / anything non-literal → dynamic
  return { present: true, value: null, dynamic: true };
}

/**
 * Walk the source's JSX and return one violation per denylisted prop/shape
 * on a kit component. Returns [] on parse failure (fail open). Shape:
 *   { component, issue, message }
 */
export function detectComponentPropViolations(source) {
  if (typeof source !== "string" || !source) return [];
  let sf;
  try {
    sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  } catch {
    return []; // fail open
  }
  const out = [];
  const visit = (node) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening) {
      const comp = kitComponentOf(opening.tagName);
      if (comp) {
        // 0) the arcade-gen 1.x compound shape on a name that is no longer
        // compound in 2.x. `<ToggleGroup.Root>` type-checks nowhere and is
        // `undefined` at runtime → "Element type is invalid" white-screen.
        const replacement = COMPOUND_ONLY_IN_V1.get(comp);
        if (replacement) {
          const subpart = kitSubpartOf(opening.tagName);
          if (subpart === "Root") {
            out.push({
              component: comp,
              issue: "removed-compound-root",
              message: `<${comp}.Root> no longer exists — \`${comp}\` is not a compound component. The row of mutually exclusive pills is now \`${replacement}\`: use <${replacement}.Root> + <${replacement}.Item value="…">. Leaving \`${comp}.Root\` in place renders nothing and crashes the frame.`,
            });
          } else if (subpart === "Item" && attr(opening, "value")) {
            out.push({
              component: comp,
              issue: "renamed-item-prop",
              message: `<${comp}.Item> takes \`label\` (plus optional \`description\`/\`pressed\`/\`onPressedChange\`), not \`value\`. If you wanted the segmented pill row, switch the whole group to \`${replacement}\`, whose \`.Item\` does take \`value\`.`,
            });
          }
        }
        // 0b) `.Root` on an export that has no `.Root`. Same crash class as
        // above, different cause: these were never compound in either version.
        const shouldWrite = NO_ROOT_SUBPART.get(comp);
        if (shouldWrite && kitSubpartOf(opening.tagName) === "Root") {
          out.push({
            component: comp,
            issue: "no-root-subpart",
            message: `<${comp}.Root> does not exist — \`${comp}\` is not a compound component. Write ${shouldWrite}. \`${comp}.Root\` is \`undefined\` at runtime, which crashes the whole frame.`,
          });
        }
        // 1) invented boolean `multiple` prop — none of the four take it.
        if (NO_MULTIPLE_PROP.has(comp) && attr(opening, "multiple")) {
          out.push({
            component: comp,
            issue: "multiple-prop",
            message: STRING_ONLY_COMPONENTS.has(comp)
              ? `<${comp}.Root> has no \`multiple\` prop and no multi-select in the kit — remove it (keep it single, or approximate + note as a Deviation).`
              : `<${comp}.Root> has no \`multiple\` prop — express multi-select as \`type="multiple"\`.`,
          });
        }
        // 2) array value/defaultValue where a string is required.
        for (const prop of ["value", "defaultValue"]) {
          const a = attr(opening, prop);
          if (!a || !isArrayLiteralInitializer(a)) continue;
          if (STRING_ONLY_COMPONENTS.has(comp)) {
            out.push({
              component: comp,
              issue: `array-${prop}`,
              message: `<${comp}.Root> \`${prop}\` is a string, not an array — pass a single value (the kit has no multi-select ${comp}).`,
            });
          } else if (UNION_TYPE_COMPONENTS.has(comp)) {
            const t = typeLiteral(opening);
            // Array is VALID under type="multiple". Flag only when type is a
            // LITERAL "single" or ABSENT. Dynamic type={x} → SKIP.
            if (!t.dynamic && t.value !== "multiple") {
              out.push({
                component: comp,
                issue: `array-${prop}`,
                message: `<${comp}.Root> \`${prop}\` is an array but \`type\` is not "multiple" — set \`type="multiple"\` for multi-value.`,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Build the stderr block the hook emits on a block. */
export function formatComponentPropError(violations) {
  if (!violations.length) return "";
  const lines = [
    "Blocked: a component prop that doesn't exist in the kit (it would be",
    "silently ignored or break the control at runtime — a false success).",
    "",
  ];
  for (const v of violations) {
    lines.push(`  - ${v.message}`);
  }
  lines.push("");
  lines.push("Fix the prop(s) and re-Write. If the kit genuinely can't do the ask,");
  lines.push("build the closest real thing and report it in `### Deviations` — never");
  lines.push("claim a change you didn't actually make. This hook runs on every Write/Edit.");
  return lines.join("\n");
}

/** Files this hook judges: frame .ts/.tsx source. Mirrors the sibling hooks'
 *  scope — skips the sidecar json artifacts. */
export function isInScope(filePath) {
  if (typeof filePath !== "string") return false;
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return false;
  const base = path.basename(filePath);
  if (base === "index.errors.json" || base === "project.json") return false;
  return true;
}

function extractContent(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  if (toolName === "Write") return typeof toolInput.content === "string" ? toolInput.content : "";
  if (toolName === "Edit") return typeof toolInput.new_string === "string" ? toolInput.new_string : "";
  return "";
}

async function readStdin() {
  let buf = "";
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

async function main() {
  let payload;
  try {
    const raw = await readStdin();
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    process.exit(0);
  }
  const toolName = payload?.tool_name;
  const toolInput = payload?.tool_input;
  if (toolName !== "Write" && toolName !== "Edit") process.exit(0);
  const filePath = toolInput?.file_path;
  if (!isInScope(filePath)) process.exit(0);

  // Edit fires POST-write, so the file on disk is already the post-edit source.
  // Validate the WHOLE file (not just the new_string snippet — a bad prop may
  // live elsewhere). Fall back to the tool content on read error (new-file/race).
  let content = extractContent(toolName, toolInput);
  if (toolName === "Edit" && filePath) {
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      // new-file/race: keep the new_string already in `content`
    }
  }
  if (!content) process.exit(0);

  const violations = detectComponentPropViolations(content);
  if (violations.length === 0) process.exit(0);

  process.stderr.write(formatComponentPropError(violations));
  process.exit(2);
}

// Allow importing for tests without running main(). Compare resolved file URLs
// (percent-encoded), NOT a hand-built `file://${argv[1]}` — a path with spaces
// (".../Arcade Studio.app/...") would never match and main() would silently
// never run, disabling the hook in the packaged app. See validateArcadeImports.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => process.exit(0));
}
