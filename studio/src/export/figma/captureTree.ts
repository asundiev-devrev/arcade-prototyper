// studio/src/export/figma/captureTree.ts

/** Raw node shape as fetched from the Bridge (absolute canvas coords). */
export interface RawCaptureNode {
  id: string;
  name: string;
  type: string;
  absX: number;
  absY: number;
  width: number;
  height: number;
  children: RawCaptureNode[];
}

/** A normalized capture node: frame-relative box + parent reference. */
export interface CaptureNode {
  id: string;
  name: string;
  type: string;
  x: number;       // relative to the capture root frame
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

/** Bridge seam: returns the raw subtree (with absolute coords) for a node id.
 *  The live impl runs a figma_execute that walks the node and reports
 *  absoluteBoundingBox; tests pass a fake. */
export interface CaptureBridge {
  getSubtree(nodeId: string): Promise<RawCaptureNode>;
}

/** Read a captured Figma node into a flat, frame-relative CaptureNode list. */
export async function readCaptureTree(bridge: CaptureBridge, rootNodeId: string): Promise<CaptureNode[]> {
  const root = await bridge.getSubtree(rootNodeId);
  const originX = root.absX;
  const originY = root.absY;
  const out: CaptureNode[] = [];
  function walk(n: RawCaptureNode, parentId: string | null): void {
    out.push({
      id: n.id, name: n.name, type: n.type,
      x: Math.round(n.absX - originX), y: Math.round(n.absY - originY),
      width: Math.round(n.width), height: Math.round(n.height),
      parentId,
    });
    for (const c of n.children) walk(c, n.id);
  }
  walk(root, null);
  return out;
}
