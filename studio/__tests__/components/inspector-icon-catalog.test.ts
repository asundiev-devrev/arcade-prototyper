import { describe, it, expect } from "vitest";
import { iconNameSet, iconSvg, iconList } from "../../src/components/inspector/iconCatalog";

const CATALOG = { sections: [
  { kind: "component", items: [{ name: "Button", doc: "", thumb: null }] },
  { kind: "icon", items: [
    { name: "Bell", category: "Alerts", tags: ["notify"], svg: "<svg>bell</svg>" },
    { name: "Star", category: "Shapes", tags: ["fav"], svg: "<svg>star</svg>" },
  ] },
] };

describe("iconCatalog", () => {
  it("iconNameSet lists only icon-section names", () => {
    const s = iconNameSet(CATALOG as any);
    expect(s.has("Bell")).toBe(true);
    expect(s.has("Star")).toBe(true);
    expect(s.has("Button")).toBe(false);
  });
  it("iconSvg returns the svg by name, undefined when absent", () => {
    expect(iconSvg(CATALOG as any, "Bell")).toBe("<svg>bell</svg>");
    expect(iconSvg(CATALOG as any, "Nope")).toBeUndefined();
  });
  it("iconList returns {name,svg,tags}", () => {
    expect(iconList(CATALOG as any)).toHaveLength(2);
    expect(iconList(CATALOG as any)[0]).toMatchObject({ name: "Bell", svg: "<svg>bell</svg>", tags: ["notify"] });
  });
});
