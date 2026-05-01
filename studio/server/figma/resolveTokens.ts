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
 * The raw figmanage node tree (`rawRoot`) is walked in parallel so we can
 * read `boundVariables` — we could not preserve them through compactTree
 * without inflating every CompactNode.
 */
export function resolveTokens(
  tree: CompactNode,
  rawRoot: any,
  variablesPayload: any | null,
): ResolveResult {
  const tokens: ResolvedTokens = { colors: {}, typography: {}, spacing: {} };
  const warnings: string[] = [];

  const vars = variablesPayload?.variables;
  if (!vars || typeof vars !== "object") {
    warnings.push("variables unavailable; styles left raw");
    return { tree, tokens, warnings };
  }

  // Cross-walk trees by path. The raw tree may have different structure
  // (passthrough groups were collapsed), so we instead build an index of
  // raw nodes keyed by a synthetic path that matches compactTree's
  // convention when no collapsing happened. When the paths diverge, we
  // fall back to best-effort lookup by node name.
  const rawByPath = indexRaw(rawRoot);

  function recur(node: CompactNode): CompactNode {
    const raw = rawByPath.get(node.id);
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

function indexRaw(root: any): Map<string, any> {
  const out = new Map<string, any>();
  function recur(n: any, pathId: string, depth: number): void {
    if (!n || typeof n !== "object") return;
    if (depth > 20) return;
    out.set(pathId, n);
    const kids: any[] = Array.isArray(n.children) ? n.children : [];
    kids.forEach((k, i) => recur(k, `${pathId}.${i}`, depth + 1));
  }
  recur(root, "0", 0);
  return out;
}
