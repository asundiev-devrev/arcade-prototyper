// studio/src/export/figma/swapOps.ts
import type { Box, SljDocument, SljNode } from "../slj";
import { isComponentNode } from "../slj";

/** A recognized component pulled out of the SLJ for the swap to place. */
export interface ManifestComponent {
  component: string;                 // e.g. "ComputerSidebar.Item", "ChatBubble"
  box: Box;                          // frame-relative
  props: Record<string, unknown>;
  text: string | null;              // first visible text under the component, or null
  /** arcade-gen icon name of the glyph inside this component, if any. */
  icon?: string;
}

/** First visible text anywhere under a node (depth-first). */
function firstText(node: SljNode): string | null {
  if (node.kind === "element" && node.tag === "text" && node.style.characters !== undefined) {
    return node.style.characters;
  }
  for (const c of node.children) {
    const t = firstText(c);
    if (t !== null) return t;
  }
  return null;
}

/** Flatten the SLJ into the list of recognized components. Stops at each
 *  component (does NOT descend past it — the fiber walk already pruned a
 *  mapped primitive's internals, so a component's subtree is only its text). */
export function flattenManifest(slj: SljDocument): ManifestComponent[] {
  const out: ManifestComponent[] = [];
  function walk(node: SljNode): void {
    if (isComponentNode(node)) {
      out.push({ component: node.component, box: node.box, props: node.props, text: firstText(node), icon: node.icon });
      return; // do not descend into a component's children
    }
    for (const c of node.children) walk(c);
  }
  walk(slj.root);
  return out;
}

/** Ops the swap planner emits; executeSwap applies them over the Bridge. */
export type SwapOp =
  | {
      op: "replaceWithInstance";
      targetNodeId: string;            // the captured flat frame to replace
      componentSetKey: string;
      variant?: Record<string, string>;
      box: Box;                        // frame-relative target box
      parentNodeId: string;            // captured parent to attach under
      text?: { propName?: string; characters: string };
      binds?: { field: "fill" | "stroke"; variableKey: string }[];
      /** Set the instance's inner Icons/* child to this component-set key. */
      icon?: { setKey: string };
    }
  | {
      op: "injectInstances";
      containerNodeId: string;         // captured transcript container
      clearChildren: boolean;
      instances: Array<{
        componentSetKey: string;
        variant?: Record<string, string>;
        box: Box;                      // relative to the container
        text?: { propName?: string; characters: string };
      }>;
    };
