// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ArtefactCard } from "../../prototype-kit/composites/ArtefactCard";

afterEach(() => cleanup());

describe("ArtefactCard", () => {
  it("renders the tag and title", () => {
    render(<ArtefactCard tag="DOC" title="Q3 launch brief" />);
    expect(screen.getByText("DOC")).toBeTruthy();
    expect(screen.getByText("Q3 launch brief")).toBeTruthy();
  });

  it("renders the CTA and fires onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(<ArtefactCard tag="DOC" title="Q3 launch brief" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /open in canvas/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("omits the CTA when onOpen is not provided", () => {
    render(<ArtefactCard tag="DOC" title="Q3 launch brief" />);
    expect(screen.queryByRole("button", { name: /open in canvas/i })).toBeNull();
  });

  it("emits the stack-scale breakpoints in descending-px order (narrowest wins)", () => {
    const { container } = render(<ArtefactCard tag="DOC" title="Q3 launch brief" />);
    const cls = (container.firstElementChild as HTMLElement).className;
    const pxOrder = [...cls.matchAll(/@max-\[(\d+)px\]\/chat:\[--stack-scale/g)].map((m) => Number(m[1]));
    expect(pxOrder.length).toBe(5);
    const sorted = [...pxOrder].sort((a, b) => b - a);
    expect(pxOrder).toEqual(sorted);
  });
});
