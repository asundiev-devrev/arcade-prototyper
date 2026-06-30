import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { EditBlocksProvider, useEditBlocks } from "../../src/hooks/editBlocksContext";

const wrap = ({ children }: { children: React.ReactNode }) => <EditBlocksProvider>{children}</EditBlocksProvider>;

describe("editBlocks", () => {
  it("adds a block and returns its id", () => {
    const { result } = renderHook(() => useEditBlocks(), { wrapper: wrap });
    let id = "";
    act(() => { id = result.current.addBlock({ label: "padding → 24", kind: "instant", status: "applied", frameSlug: "01-x" }); });
    expect(id).toBeTruthy();
    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.blocks[0].label).toBe("padding → 24");
  });
  it("setStatus updates a block", () => {
    const { result } = renderHook(() => useEditBlocks(), { wrapper: wrap });
    let id = "";
    act(() => { id = result.current.addBlock({ label: "x", kind: "ai", status: "pending", frameSlug: "01-x" }); });
    act(() => { result.current.setStatus(id, "working"); });
    expect(result.current.blocks[0].status).toBe("working");
  });
  it("removeBlock drops it", () => {
    const { result } = renderHook(() => useEditBlocks(), { wrapper: wrap });
    let id = "";
    act(() => { id = result.current.addBlock({ label: "x", kind: "instant", status: "applied", frameSlug: "01-x" }); });
    act(() => { result.current.removeBlock(id); });
    expect(result.current.blocks).toHaveLength(0);
  });
});
