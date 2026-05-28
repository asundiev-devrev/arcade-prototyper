import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NarrationTicker } from "../../src/components/viewport/NarrationTicker";

describe("NarrationTicker", () => {
  afterEach(() => cleanup());

  it("hides when phase idle and no narrations", () => {
    const { container } = render(
      <NarrationTicker narrations={[]} lastTool={null} phase="idle" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows last 3 narrations newest at top", () => {
    const { container } = render(
      <NarrationTicker
        narrations={["one", "two", "three", "four", "five"]}
        lastTool={null}
        phase="running"
      />,
    );
    const items = container.querySelectorAll<HTMLDivElement>("[data-testid=\"narration-item\"]");
    expect(Array.from(items).map((el) => el.textContent)).toEqual(["five", "four", "three"]);
  });

  it("renders lastTool pretty string", () => {
    const { container } = render(
      <NarrationTicker
        narrations={[]}
        lastTool={{ name: "Read", pretty: "Reading kit-manifest.md" }}
        phase="running"
      />,
    );
    expect(container.textContent).toContain("Reading kit-manifest.md");
  });

  it("fades older narrations", () => {
    const { container } = render(
      <NarrationTicker
        narrations={["a", "b", "c"]}
        lastTool={null}
        phase="running"
      />,
    );
    const items = container.querySelectorAll<HTMLDivElement>("[data-testid=\"narration-item\"]");
    const opacities = Array.from(items).map((el) => parseFloat(el.style.opacity));
    expect(opacities[0]).toBeGreaterThan(opacities[2]);
  });
});
