// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FrameLink } from "../../prototype-kit/composites/FrameLink";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FrameLink", () => {
  it("renders its children", () => {
    render(
      <FrameLink target="02-modal">
        <span>Open modal</span>
      </FrameLink>,
    );
    expect(screen.getByText("Open modal")).toBeTruthy();
  });

  it("applies role='button' and tabIndex=0 so keyboard users can activate it", () => {
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    const link = screen.getByRole("button");
    expect(link.getAttribute("tabindex")).toBe("0");
  });

  it("posts a navigate message to window.parent on click", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [msg] = postMessage.mock.calls[0];
    expect(msg.type).toBe("arcade-studio:navigate");
    expect(msg.target).toBe("02-modal");
  });

  it("posts a navigate message when Enter is pressed", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("posts a navigate message when Space is pressed", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("does not post a message when other keys are pressed", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "a" });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
