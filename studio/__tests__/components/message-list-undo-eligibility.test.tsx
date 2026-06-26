// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { EditBlock } from "../../src/hooks/editBlocksContext";

/** Helper extracted from MessageList for testing.
 *  Returns true if this block is the newest applied instant block for its frame. */
function isNewestAppliedInstantForFrame(block: EditBlock, all: EditBlock[]): boolean {
  if (block.kind !== "instant" || block.status !== "applied") return false;
  // Walk backward from the end to find the last applied instant for this frame.
  for (let i = all.length - 1; i >= 0; i--) {
    const candidate = all[i];
    if (candidate.frameSlug === block.frameSlug &&
        candidate.kind === "instant" &&
        candidate.status === "applied") {
      return candidate.id === block.id;
    }
  }
  return false;
}

describe("MessageList undo eligibility (LIFO-consistent)", () => {
  it("single applied instant block for a frame is undoable", () => {
    const blocks: EditBlock[] = [
      { id: "b1", label: "padding", kind: "instant", status: "applied", frameSlug: "home" },
    ];
    expect(isNewestAppliedInstantForFrame(blocks[0], blocks)).toBe(true);
  });

  it("newest applied instant for a frame is undoable (older is not)", () => {
    const blocks: EditBlock[] = [
      { id: "b1", label: "padding", kind: "instant", status: "applied", frameSlug: "home" },
      { id: "b2", label: "margin", kind: "instant", status: "applied", frameSlug: "home" },
    ];
    expect(isNewestAppliedInstantForFrame(blocks[0], blocks)).toBe(false); // older
    expect(isNewestAppliedInstantForFrame(blocks[1], blocks)).toBe(true);  // newest
  });

  it("multiple frames: each gets its own newest-applied", () => {
    const blocks: EditBlock[] = [
      { id: "b1", label: "x", kind: "instant", status: "applied", frameSlug: "home" },
      { id: "b2", label: "y", kind: "instant", status: "applied", frameSlug: "settings" },
      { id: "b3", label: "z", kind: "instant", status: "applied", frameSlug: "home" },
    ];
    expect(isNewestAppliedInstantForFrame(blocks[0], blocks)).toBe(false); // older home
    expect(isNewestAppliedInstantForFrame(blocks[1], blocks)).toBe(true);  // newest settings
    expect(isNewestAppliedInstantForFrame(blocks[2], blocks)).toBe(true);  // newest home
  });

  it("undone blocks are not undoable", () => {
    const blocks: EditBlock[] = [
      { id: "b1", label: "x", kind: "instant", status: "undone", frameSlug: "home" },
      { id: "b2", label: "y", kind: "instant", status: "applied", frameSlug: "home" },
    ];
    expect(isNewestAppliedInstantForFrame(blocks[0], blocks)).toBe(false); // undone
    expect(isNewestAppliedInstantForFrame(blocks[1], blocks)).toBe(true);  // newest applied
  });

  it("ai blocks are never undoable (even if applied)", () => {
    const blocks: EditBlock[] = [
      { id: "b1", label: "x", kind: "ai", status: "applied", frameSlug: "home" },
    ];
    expect(isNewestAppliedInstantForFrame(blocks[0], blocks)).toBe(false);
  });

  it("working/pending/error instant blocks are not undoable", () => {
    const blocks: EditBlock[] = [
      { id: "b1", label: "x", kind: "instant", status: "working", frameSlug: "home" },
      { id: "b2", label: "y", kind: "instant", status: "pending", frameSlug: "home" },
      { id: "b3", label: "z", kind: "instant", status: "error", frameSlug: "home" },
    ];
    expect(isNewestAppliedInstantForFrame(blocks[0], blocks)).toBe(false);
    expect(isNewestAppliedInstantForFrame(blocks[1], blocks)).toBe(false);
    expect(isNewestAppliedInstantForFrame(blocks[2], blocks)).toBe(false);
  });

  it("interleaved instant + ai: only newest instant per frame is undoable", () => {
    const blocks: EditBlock[] = [
      { id: "b1", label: "x", kind: "instant", status: "applied", frameSlug: "home" },
      { id: "b2", label: "responsive", kind: "ai", status: "pending", frameSlug: "home" },
      { id: "b3", label: "y", kind: "instant", status: "applied", frameSlug: "home" },
      { id: "b4", label: "z", kind: "instant", status: "applied", frameSlug: "settings" },
    ];
    expect(isNewestAppliedInstantForFrame(blocks[0], blocks)).toBe(false); // older home
    expect(isNewestAppliedInstantForFrame(blocks[1], blocks)).toBe(false); // ai
    expect(isNewestAppliedInstantForFrame(blocks[2], blocks)).toBe(true);  // newest home
    expect(isNewestAppliedInstantForFrame(blocks[3], blocks)).toBe(true);  // newest settings
  });
});
