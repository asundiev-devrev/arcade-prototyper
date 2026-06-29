// studio/src/components/inspector/propField.ts
import type { KitProp2 } from "../../../server/codeWriter/compositeProps";

export interface PropFieldDescriptor {
  name: string;
  widget: "text" | "toggle" | "number" | "select";
  writePrefix: "prop:" | "propExpr:";
  value: string;          // resolved prefill: current > default > ""
  values?: string[];      // for select
}

/** Pure: resolve how a prop renders + which write path it uses + its prefill value.
 *  `current` = the value already set on the instance (from /api/instance-props), or
 *  undefined. Prefill precedence: current > default > "". */
export function renderPropField(prop: KitProp2, current: string | undefined): PropFieldDescriptor {
  const writePrefix = prop.kind === "toggle" || prop.kind === "number" ? "propExpr:" : "prop:";
  const value = current ?? prop.default ?? "";
  return {
    name: prop.name,
    widget: prop.kind,
    writePrefix,
    value,
    ...(prop.values ? { values: prop.values } : {}),
  };
}
