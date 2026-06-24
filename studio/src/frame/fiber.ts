/**
 * React-fiber helpers for the in-iframe inspector/picker. Dev-only — relies on
 * React internals (fiber keys, _debugOwner). Extracted here so both picker.ts
 * and inspector.ts can use them without a circular import.
 */

export type FiberLike = {
  _debugStack?: { stack?: string } | null;
  _debugOwner?: FiberLike | null;
  type?: unknown;
  elementType?: unknown;
  stateNode?: unknown;
  return?: FiberLike | null;
};

export function getFiberFromNode(node: Element): FiberLike | null {
  const key = Object.keys(node).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!key) return null;
  return (node as unknown as Record<string, FiberLike>)[key] ?? null;
}

export function componentNameFromType(type: unknown): string | null {
  if (!type) return null;
  if (typeof type === "string") return type;
  const t = type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
  if (t.displayName) return t.displayName;
  if (t.name) return t.name;
  if (t.render?.displayName) return t.render.displayName;
  if (t.render?.name) return t.render.name;
  return null;
}

/** Component name owning a DOM node: its own fiber type (if a component), else
 *  the _debugOwner's type. Returns null for plain host elements (div/svg) with
 *  no component owner name. */
export function componentNameOf(node: Element): string | null {
  const fiber = getFiberFromNode(node);
  if (!fiber) return null;
  // own type: a function/class component → its name; a host string (div/svg) → not a component name
  const own = fiber.type;
  if (own && typeof own !== "string") {
    const n = componentNameFromType(own);
    if (n) return n;
  }
  if (fiber._debugOwner) {
    const n = componentNameFromType(fiber._debugOwner.type);
    if (n) return n;
  }
  return null;
}
