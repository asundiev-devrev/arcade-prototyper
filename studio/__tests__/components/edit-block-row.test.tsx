// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { EditBlockRow } from "../../src/components/chat/EditBlockRow";

afterEach(() => cleanup());

describe("EditBlockRow", () => {
  it("instant/applied shows label + Undo (when undoable=true)", () => {
    const onUndo = vi.fn();
    const { getByText } = render(
      <EditBlockRow block={{ id: "b1", label: "padding → 24", kind: "instant", status: "applied", frameSlug: "f" }}
        undoable={true} onUndo={onUndo} onApply={vi.fn()} onDiscard={vi.fn()} />);
    getByText("padding → 24");
    fireEvent.click(getByText("Undo"));
    expect(onUndo).toHaveBeenCalledWith("b1");
  });
  it("instant/applied with undoable=false shows NO Undo button", () => {
    const { queryByText } = render(
      <EditBlockRow block={{ id: "b2", label: "margin → 12", kind: "instant", status: "applied", frameSlug: "f" }}
        undoable={false} onUndo={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(queryByText("Undo")).toBeNull();
  });
  it("ai/pending shows Apply + Discard; clicking Apply calls onApply with the block id", () => {
    const onApply = vi.fn(); const onDiscard = vi.fn();
    const { getByText } = render(
      <EditBlockRow block={{ id: "b3", label: "make responsive", kind: "ai", status: "pending", frameSlug: "f" }}
        onUndo={vi.fn()} onApply={onApply} onDiscard={onDiscard} />);
    fireEvent.click(getByText("Apply"));
    expect(onApply).toHaveBeenCalledWith("b3");
    fireEvent.click(getByText("Discard"));
    expect(onDiscard).toHaveBeenCalledWith("b3");
  });
  it("undone block shows a muted undone state (no Undo button)", () => {
    const { queryByText } = render(
      <EditBlockRow block={{ id: "b4", label: "x", kind: "instant", status: "undone", frameSlug: "f" }}
        undoable={false} onUndo={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(queryByText("Undo")).toBeNull();
  });
});
