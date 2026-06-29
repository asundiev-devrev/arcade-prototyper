/** The bind path of the nearest [data-arcade-bind] ancestor (or self), or null. */
export function readBindPath(el: Element | null): string | null {
  const bound = el?.closest?.("[data-arcade-bind]");
  return bound?.getAttribute("data-arcade-bind") ?? null;
}
