import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { PhantomSkeleton } from "../../src/components/viewport/PhantomSkeleton";

vi.mock("@xorkavi/arcade-gen", () => ({}));

describe("PhantomSkeleton", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(
      <PhantomSkeleton visible={false} composites={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders fallback shapes when no composites known", () => {
    const { container } = render(
      <PhantomSkeleton visible={true} composites={[]} />,
    );
    const root = container.querySelector('[data-testid="phantom-skeleton"]');
    expect(root).not.toBeNull();
    // Fallback uses 4 default blocks.
    expect(root!.querySelectorAll("[data-skeleton-block]")).toHaveLength(4);
  });

  it("uses arcade-studio-phantom-pulse animation", () => {
    const { container } = render(
      <PhantomSkeleton visible={true} composites={[]} />,
    );
    const block = container
      .querySelector('[data-testid="phantom-skeleton"]')!
      .querySelector<HTMLDivElement>("[data-skeleton-block]")!;
    expect(block.style.animation).toContain("arcade-studio-phantom-pulse");
  });

  it("renders Hero block when composite known", () => {
    const { container } = render(
      <PhantomSkeleton visible={true} composites={["Hero"]} />,
    );
    const root = container.querySelector('[data-testid="phantom-skeleton"]');
    expect(root).not.toBeNull();
    expect(
      root!.querySelector('[data-skeleton-block="Hero"]'),
    ).not.toBeNull();
  });
});
