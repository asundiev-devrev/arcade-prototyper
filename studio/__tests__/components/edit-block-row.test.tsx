// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { EditBlockRow } from "../../src/components/chat/EditBlockRow";

afterEach(() => cleanup());

describe("EditBlockRow", () => {
  it("instant/applied shows label + Undo", () => {
    const onUndo = vi.fn();
    const { getByText } = render(
      <EditBlockRow block={{ id: "b1", label: "padding → 24", kind: "instant", status: "applied", frameSlug: "f" }}
        onUndo={onUndo} onApply={vi.fn()} onDiscard={vi.fn()} />);
    getByText("padding → 24");
    fireEvent.click(getByText("Undo"));
    expect(onUndo).toHaveBeenCalledWith("b1");
  });
  it("ai/pending shows Apply + Discard", () => {
    const onApply = vi.fn(); const onDiscard = vi.fn();
    const { getByText } = render(
      <EditBlockRow block={{ id: "b2", label: "make responsive", kind: "ai", status: "pending", frameSlug: "f" }}
        onUndo={vi.fn()} onApply={onApply} onDiscard={onDiscard} />);
    fireEvent.click(getByText("Apply"));
    expect(onApply).toHaveBeenCalledWith("b2");
    fireEvent.click(getByText("Discard"));
    expect(onDiscard).toHaveBeenCalledWith("b2");
  });
  it("undone block shows a muted undone state (no Undo button)", () => {
    const { queryByText } = render(
      <EditBlockRow block={{ id: "b3", label: "x", kind: "instant", status: "undone", frameSlug: "f" }}
        onUndo={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(queryByText("Undo")).toBeNull();
  });
});
