// studio/src/export/figma/ops.ts
import type { Box, Layout } from "../slj";
import type { TextNodeHint } from "./types";

/** A flat, ordered, executable operation. Parent/child is expressed by the
 *  planner-assigned synthetic `id` / `parent` / `target` references; the executor
 *  maps each synthetic id to the real Figma node id it creates. */
export type FigmaOp =
  | { op: "createFrame"; id: string; parent: string | null; layout: Layout | null; box: Box }
  | { op: "createInstance"; id: string; parent: string; componentKey: string; variant?: Record<string, string> }
  | { op: "setText"; target: string; textNodeHint: TextNodeHint; characters: string }
  | { op: "bindVariable"; target: string; field: "fill" | "stroke"; variableKey: string }
  | { op: "setFill"; target: string; field: "fill" | "stroke"; color: string };

export type FigmaPlan = { rootId: string; ops: FigmaOp[] };

/** True for ops that create a node (and therefore assign an `id`). */
export function isCreateOp(op: FigmaOp): op is Extract<FigmaOp, { id: string }> {
  return op.op === "createFrame" || op.op === "createInstance";
}
