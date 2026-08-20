import type { CompactNode, ResolvedTokens } from "./types";

export interface ResolveResult {
  tree: CompactNode;
  tokens: ResolvedTokens;
  warnings: string[];
}

/**
 * Walk the compacted tree and rewrite any style value that is bound to a
 * Figma variable with the variable's name (e.g. "surface/default"). Raw
 * values stay in place when there is no binding.
 *
 * `rawById` comes straight from compactTree and maps each emitted node id to
 * the raw figmanage node it carries. We use that instead of re-deriving paths
 * over the raw tree: compactTree drops zero-size nodes (shifting sibling
 * indices) and collapses passthrough wrappers (the kept raw node is a
 * descendant), so an independent path rebuild silently diverges and leaves
 * bound styles un-tokenized — the cause of frames shipping raw off-palette
 * hex even when variable resolution succeeded.
 */
export function resolveTokens(
  tree: CompactNode,
  rawById: Map<string, any>,
  variablesPayload: any | null,
): ResolveResult {
  const tokens: ResolvedTokens = { colors: {}, typography: {}, spacing: {} };
  const warnings: string[] = [];

  const vars = variablesPayload?.variables;
  if (!vars || typeof vars !== "object") {
    warnings.push("variables unavailable; styles left raw");
    return { tree, tokens, warnings };
  }

  function recur(node: CompactNode): CompactNode {
    const raw = rawById.get(node.id);
    const nextStyle = { ...node.style } as NonNullable<CompactNode["style"]>;

    if (raw?.fills && nextStyle.fill) {
      const tokenName = readColorVar(raw.fills, vars);
      if (tokenName) {
        tokens.colors[tokenName] = nextStyle.fill;
        nextStyle.fill = tokenName;
      } else {
        warnings.push(`unbound fill at ${node.id}`);
      }
    }
    if (raw?.strokes && nextStyle.stroke) {
      const tokenName = readColorVar(raw.strokes, vars);
      if (tokenName) {
        tokens.colors[tokenName] = nextStyle.stroke;
        nextStyle.stroke = tokenName;
      }
    }

    // Spacing: itemSpacing → tokens.spacing, but keep layout.gap numeric
    // so the prompt still shows a usable pixel value.
    if (raw?.boundVariables?.itemSpacing && typeof raw.itemSpacing === "number") {
      const name = vars[raw.boundVariables.itemSpacing.id]?.name;
      if (name) tokens.spacing[name] = raw.itemSpacing;
    }

    const next: CompactNode = { ...node };
    if (Object.keys(nextStyle).length) next.style = nextStyle;
    if (node.children) next.children = node.children.map(recur);
    return next;
  }

  const nextTree = recur(tree);
  return { tree: nextTree, tokens, warnings };
}

/**
 * The paint that decides the ink a person actually sees.
 *
 * Figma draws a theme-aware colour as a STACK, not as one paint: a half-opacity
 * COLOR_DODGE layer, an opaque MULTIPLY layer bound to the colour variable, and a
 * zero-opacity NORMAL white. That is the machinery that lets one component flip
 * between light and dark; only the opaque layer is ink, the other two are switches.
 *
 * Reading "the first visible solid" therefore picked the 50% dodge layer, and every
 * theme-aware string imported at half strength — measurably lighter on screen than
 * the design — while also losing its token, because the dodge layer carries no
 * boundVariables.
 *
 * So: an opaque paint hides everything beneath it and is the ink. Only when no paint
 * is opaque does the first visible one win, which keeps genuinely translucent text
 * (a disabled label at 40%) translucent.
 */
export function inkPaint(paints: any): any | undefined {
  if (!Array.isArray(paints)) return undefined;
  const strength = (p: any) => (p.opacity ?? 1) * (p.color?.a ?? 1);
  const visible = paints.filter((p) => p?.type === "SOLID" && p.visible !== false && strength(p) > 0);
  if (!visible.length) return undefined;
  const opaque = visible.filter((p) => strength(p) >= 0.999);
  // Later paints render above earlier ones, so the last opaque paint is the top of the stack.
  return opaque.length ? opaque[opaque.length - 1] : visible[0];
}

/**
 * The Figma variable NAME bound to the paint that carries the visible ink, or
 * undefined when no paint is bound. Shared with the kit-emit engine
 * (kitEmit.ts) so both color paths read the same binding — the kit-emit branch
 * borrows ONLY this reader and does its own name → kit-token transform, rather
 * than re-running the compacted-tree rewrite above (which kit-emit doesn't use).
 *
 * When the ink paint itself is unbound, any bound sibling still wins over nothing:
 * a token is theme-correct where a baked hex is only correct in one theme.
 */
export function readColorVar(paints: any[], vars: Record<string, any>): string | undefined {
  const ink = inkPaint(paints);
  const bound = ink?.boundVariables?.color?.id
    ? ink
    : Array.isArray(paints)
      ? paints.find((p) => p?.type === "SOLID" && p.visible !== false && p.boundVariables?.color?.id)
      : undefined;
  const aliasId = bound?.boundVariables?.color?.id;
  if (!aliasId) return undefined;
  return vars[aliasId]?.name;
}
