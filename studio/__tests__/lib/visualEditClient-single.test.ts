import { describe, it, expect, vi } from "vitest";
import { buildSingleEdit, postEditUndo } from "../../src/lib/visualEditClient";
import type { EditedElement } from "../../src/hooks/editSessionContext";

const sel: EditedElement["selection"] = {
  editId: 1, file: "/p/projects/demo/frames/01-x/index.tsx", line: 3, column: 6,
  componentName: "div", tagName: "div", textEditable: true, styles: {} as any, ownerChain: [],
};

describe("buildSingleEdit", () => {
  it("makes a one-field payload targeting the session frame", () => {
    const p = buildSingleEdit(sel, "paddingTop", "24px", "01-x");
    expect(p.frameSlug).toBe("01-x");
    expect(p.edits).toHaveLength(1);
    expect(p.edits[0].fields).toContainEqual({ field: "paddingTop", value: "24px" });
    expect(p.edits[0].line).toBe(3);
  });
  it("routes text into edit.text, not fields", () => {
    const p = buildSingleEdit(sel, "text", "Hello", "01-x");
    expect(p.edits[0].text).toBe("Hello");
    expect(p.edits[0].fields.find((f) => f.field === "text")).toBeUndefined();
  });
});

describe("postEditUndo", () => {
  it("POSTs to the undo route, returns parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await postEditUndo("demo", "01-x");
    expect(fetchMock).toHaveBeenCalledWith("/api/edit-undo/demo", expect.objectContaining({ method: "POST" }));
    expect(r).toEqual({ ok: true });
  });
  it("ok:false on network throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect((await postEditUndo("demo", "01-x")).ok).toBe(false);
  });
});
