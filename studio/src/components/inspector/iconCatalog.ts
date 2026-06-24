import type { Catalog, IconItem } from "../assets/useAssetsCatalog";

function icons(catalog: Catalog): IconItem[] {
  const sec = catalog.sections.find((s) => s.kind === "icon");
  return (sec?.items as IconItem[] | undefined) ?? [];
}
export function iconNameSet(catalog: Catalog): Set<string> {
  return new Set(icons(catalog).map((i) => i.name));
}
export function iconSvg(catalog: Catalog, name: string): string | undefined {
  return icons(catalog).find((i) => i.name === name)?.svg;
}
export function iconList(catalog: Catalog): { name: string; svg: string; tags: string[] }[] {
  return icons(catalog).map((i) => ({ name: i.name, svg: i.svg, tags: i.tags }));
}
