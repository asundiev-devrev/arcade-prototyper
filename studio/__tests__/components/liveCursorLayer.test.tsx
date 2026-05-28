import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import {
  LiveCursorLayer,
  targetPointFor,
} from "../../src/components/viewport/LiveCursorLayer";

vi.mock("@xorkavi/arcade-gen", () => ({}));

function Harness(props: {
  agentCursor: any;
  phase: any;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref} style={{ position: "relative", width: 800, height: 600 }}>
      <div data-frame-slug="home" style={{ position: "absolute", left: 100, top: 50, width: 400, height: 300 }} />
      <LiveCursorLayer
        agentCursor={props.agentCursor}
        phase={props.phase}
        containerRef={ref as RefObject<HTMLDivElement>}
        frames={[{ slug: "home", name: "Home" }] as any}
      />
    </div>
  );
}

describe("targetPointFor", () => {
  const containerRect = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
  const frameRect = { left: 100, top: 50, width: 400, height: 300 } as DOMRect;

  it("reading sits at top-left inset by 24px", () => {
    expect(targetPointFor(frameRect, containerRect, "reading")).toEqual({
      x: 124,
      y: 74,
    });
  });

  it("writing returns a point inside the upper third of the frame", () => {
    const p = targetPointFor(frameRect, containerRect, "writing", "/p/frames/home/index.tsx");
    expect(p.x).toBeGreaterThanOrEqual(124);
    expect(p.x).toBeLessThan(100 + 400);
    expect(p.y).toBeGreaterThanOrEqual(74);
    expect(p.y).toBeLessThan(50 + 300 / 3 + 24);
  });

  it("thinking parks at frame center", () => {
    expect(targetPointFor(frameRect, containerRect, "thinking")).toEqual({
      x: 300, // 100 + 400/2
      y: 200, // 50  + 300/2
    });
  });

  it("subtracts container offset so coords are layer-local", () => {
    const offset = { left: 30, top: 20, width: 800, height: 600 } as DOMRect;
    const p = targetPointFor(frameRect, offset, "reading");
    expect(p).toEqual({ x: 124 - 30, y: 74 - 20 });
  });
});

describe("LiveCursorLayer", () => {
  it("renders nothing when phase is idle", () => {
    const { container } = render(<Harness phase="idle" agentCursor={null} />);
    expect(container.querySelector('[data-testid="live-cursor"]')).toBeNull();
  });

  it("renders a pointer when phase is running and a cursor state is set", () => {
    const { container } = render(
      <Harness
        phase="running"
        agentCursor={{
          frame: null,
          action: "thinking",
          composites: [],
          updatedAt: Date.now(),
        }}
      />,
    );
    expect(container.querySelector('[data-testid="live-cursor"]')).not.toBeNull();
  });

  it("renders a bubble when narration is present", () => {
    const { container } = render(
      <Harness
        phase="running"
        agentCursor={{
          frame: null,
          action: "thinking",
          composites: [],
          narration: "Reading existing frames",
          updatedAt: Date.now(),
        }}
      />,
    );
    const bubble = container.querySelector(
      '[data-testid="live-cursor-bubble"]',
    ) as HTMLElement | null;
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toContain("Reading");
  });
});
