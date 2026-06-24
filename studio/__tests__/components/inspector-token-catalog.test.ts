// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { colorTokens, typeTokens, colorClassName, colorTokenFromClass } from "../../src/components/inspector/tokenCatalog";

describe("colorTokens", () => {
  it("returns curated fg/bg/stroke/surface tokens, excludes --component-*", () => {
    const toks = colorTokens();
    expect(toks.length).toBeGreaterThan(20);
    expect(toks.some((t) => t.token === "--fg-neutral-prominent")).toBe(true);
    expect(toks.some((t) => t.token.startsWith("--component-"))).toBe(false);
    // labels are human-ish
    expect(toks.find((t) => t.token === "--fg-neutral-prominent")!.label.length).toBeGreaterThan(0);
  });
});

describe("typeTokens", () => {
  it("lists named arcade type styles with labels", () => {
    const ts = typeTokens();
    expect(ts.some((t) => t.className === "text-body-medium")).toBe(true);
    expect(ts.some((t) => t.className === "text-title-large")).toBe(true);
    expect(ts.find((t) => t.className === "text-body-medium")!.label).toBe("Body medium");
  });
});

describe("colorClassName / colorTokenFromClass round-trip", () => {
  it("builds the right prefix per slot", () => {
    expect(colorClassName("--fg-neutral-prominent", "color")).toBe("text-(--fg-neutral-prominent)");
    expect(colorClassName("--bg-success-medium", "backgroundColor")).toBe("bg-(--bg-success-medium)");
    expect(colorClassName("--stroke-neutral-subtle", "borderColor")).toBe("border-(--stroke-neutral-subtle)");
  });
  it("parses a class back to token + slot", () => {
    expect(colorTokenFromClass("text-(--fg-neutral-prominent)")).toEqual({ token: "--fg-neutral-prominent", slot: "color" });
    expect(colorTokenFromClass("bg-(--surface-canvas)")).toEqual({ token: "--surface-canvas", slot: "backgroundColor" });
    expect(colorTokenFromClass("p-4")).toBeNull();
  });
});
