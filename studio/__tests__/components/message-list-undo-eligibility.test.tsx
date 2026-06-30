// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { EditBlock } from "../../src/hooks/editBlocksContext";
import { isNewestAppliedInstantForFrame } from "../../src/components/chat/MessageList";

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

  it("AI-applied frame gates instant Undo for that frame", () => {
    const blocks: EditBlock[] = [
      { id: "b1", label: "x", kind: "instant", status: "applied", frameSlug: "home" },
      { id: "b2", label: "y", kind: "instant", status: "applied", frameSlug: "settings" },
    ];
    const framesWithAiApply = new Set(["home"]);
    // home's newest instant is NOT undoable because an AI Apply occurred for home.
    expect(isNewestAppliedInstantForFrame(blocks[0], blocks, framesWithAiApply)).toBe(false);
    // settings had no AI Apply → its newest instant is still undoable.
    expect(isNewestAppliedInstantForFrame(blocks[1], blocks, framesWithAiApply)).toBe(true);
  });
});
