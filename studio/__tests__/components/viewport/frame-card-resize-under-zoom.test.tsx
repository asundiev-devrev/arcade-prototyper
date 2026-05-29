import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// Match the mock pattern used elsewhere in the suite — keep minimal; FrameCard
// only uses a few pieces from arcade-gen.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  return {
    IconButton: passthrough("button"),
    ArrowUpRightSmall: () => null,
    TrashBin: () => null,
    Tooltip: ({ children }: any) => children,
    useToast: () => ({ toast: () => {} }),
  };
});

import { FrameCard } from "../../../src/components/viewport/FrameCard";
import { TargetSelectionProvider } from "../../../src/hooks/targetSelectionContext";

beforeEach(() => {
  cleanup();
});

function renderCard(zoom: number, onFrameWidthChange: (n: number) => void) {
  return render(
    <TargetSelectionProvider>
      <FrameCard
        projectSlug="slug"
        frame={{ slug: "f", name: "Frame", path: "", width: 1440, height: 900 } as any}
        frameWidth={1000}
        onFrameWidthChange={onFrameWidthChange}
        projectMode="light"
        zoom={zoom}
      />
    </TargetSelectionProvider>,
  );
}

describe("FrameCard resize under zoom", () => {
  it("at zoom=1, 100px of mouse travel adds 100px of frame width", () => {
    const onChange = vi.fn();
    const { container } = renderCard(1.0, onChange);
    const handle = container.querySelector('[aria-label="Resize frame"]') as HTMLElement;
    expect(handle).toBeTruthy();

    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 600 });

    expect(onChange).toHaveBeenLastCalledWith(1100);
  });

  it("at zoom=0.5, 100px of mouse travel adds 200px of frame width", () => {
    const onChange = vi.fn();
    const { container } = renderCard(0.5, onChange);
    const handle = container.querySelector('[aria-label="Resize frame"]') as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 600 });

    expect(onChange).toHaveBeenLastCalledWith(1200);
  });

  it("at zoom=2, 100px of mouse travel adds 50px of frame width", () => {
    const onChange = vi.fn();
    const { container } = renderCard(2.0, onChange);
    const handle = container.querySelector('[aria-label="Resize frame"]') as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 600 });

    expect(onChange).toHaveBeenLastCalledWith(1050);
  });
});
