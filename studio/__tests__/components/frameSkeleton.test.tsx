import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FrameSkeleton } from "../../src/components/viewport/FrameSkeleton";

vi.mock("@xorkavi/arcade-gen", () => ({}));

describe("FrameSkeleton", () => {
  it("renders nothing when visible is false", () => {
    const { container } = render(<FrameSkeleton visible={false} composites={["Hero"]} />);
    expect(container.querySelector('[data-testid="frame-skeleton"]')).toBeNull();
  });

  it("renders generic 4-block fallback when composites is empty", () => {
    const { container } = render(<FrameSkeleton visible composites={[]} />);
    const blocks = container.querySelectorAll('[data-skeleton-block]');
    expect(blocks).toHaveLength(4);
  });

  it("renders one block per known composite", () => {
    const { container } = render(<FrameSkeleton visible composites={["Header", "Hero", "Footer"]} />);
    const blocks = container.querySelectorAll('[data-skeleton-block]');
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores unknown composites without crashing", () => {
    const { container } = render(<FrameSkeleton visible composites={["TotallyMadeUp"]} />);
    expect(container.querySelector('[data-testid="frame-skeleton"]')).not.toBeNull();
  });

  it("renders Card with the registry repeat count", () => {
    const { container } = render(<FrameSkeleton visible composites={["Card"]} />);
    const cardBlocks = container.querySelectorAll('[data-skeleton-block="Card"]');
    expect(cardBlocks).toHaveLength(3);
  });
});
