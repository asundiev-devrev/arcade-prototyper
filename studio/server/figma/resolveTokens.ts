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

function readColorVar(paints: any[], vars: Record<string, any>): string | undefined {
  const solid = paints.find((p) => p?.type === "SOLID" && p.visible !== false);
  const aliasId = solid?.boundVariables?.color?.id;
  if (!aliasId) return undefined;
  return vars[aliasId]?.name;
}
