// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const Computer: any = () => React.createElement("span", { "data-testid": "computer-icon" });
  return { Computer };
});

import { ChimeInNote } from "../../../src/components/chat/computer/ChimeInNote";

afterEach(() => cleanup());

const chime = {
  id: "ci-1",
  frameSlug: "01-x",
  objection: "Tickets don't auto-close when assigned in DevRev.",
  createdAt: "t",
  status: "pending" as const,
};

describe("ChimeInNote", () => {
  it("shows the objection's first line collapsed", () => {
    const { getByText } = render(
      <ChimeInNote chime={chime} onApply={() => {}} onDismiss={() => {}} />,
    );
    expect(getByText(/Computer noticed something/i)).toBeTruthy();
  });

  it("fires onApply and onDismiss", () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <ChimeInNote chime={chime} onApply={onApply} onDismiss={onDismiss} />,
    );
    fireEvent.click(getByRole("button", { name: /apply/i }));
    fireEvent.click(getByRole("button", { name: /dismiss/i }));
    expect(onApply).toHaveBeenCalledWith(chime);
    expect(onDismiss).toHaveBeenCalledWith(chime);
  });
});
