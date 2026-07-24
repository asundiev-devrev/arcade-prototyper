// @vitest-environment jsdom
//
// PRODUCER ↔ DETECTOR CONTRACT.
//
// The scoped-edit signal has one producer (buildTargetPreamble in PromptInput)
// and two detectors (isScopedEditPrompt, used by turn routing + edit-context
// enrichment). They used to agree via a hand-copied human string
// ("Target element:") and drifted: the producer emits THREE header shapes
// (single / plural / baked) and the detector matched only the singular colon
// form, so multi-select and baked-element edits were not recognised — they
// misrouted to a NEW-frame Figma import and lost the reference-not-rebuild
// discipline. Every prior test constructed only the singular shape, so the gap
// stayed green.
//
// This test runs the REAL producer over every shape and asserts the REAL
// detector recognises each. It fails if either side drifts from the sentinel.
import { describe, it, expect } from "vitest";
import { buildTargetPreamble } from "../../src/components/chat/PromptInput";
import { isScopedEditPrompt } from "../../src/lib/scopedEdit";
import type { EditedElement } from "../../src/hooks/editSessionContext";

function pick(file: string, componentName: string, tagName: string, line = 10): EditedElement {
  return {
    id: `${file}:${line}`,
    selection: { file, componentName, tagName, line, column: 2, ownerChain: [] },
  } as unknown as EditedElement;
}

const FRAME = "01-figma-8139-41293";

describe("scoped-edit producer ↔ detector contract", () => {
  it("SINGLE in-frame element → preamble is detected", () => {
    const out = buildTargetPreamble([pick(`/p/frames/${FRAME}/index.tsx`, "Button", "button")], FRAME);
    expect(out).toContain("Target element:");
    expect(isScopedEditPrompt(out)).toBe(true);
  });

  it("MULTI-SELECT (plural header) → preamble is detected", () => {
    const out = buildTargetPreamble(
      [
        pick(`/p/frames/${FRAME}/index.tsx`, "Button", "button", 10),
        pick(`/p/frames/${FRAME}/index.tsx`, "Button", "button", 20),
      ],
      FRAME,
    );
    // Real producer emits the PLURAL header that the old detector missed.
    expect(out).toContain("Target elements:");
    expect(isScopedEditPrompt(out)).toBe(true);
  });

  it("BAKED kit element (no in-frame anchor) → preamble is detected", () => {
    // A pick whose file is NOT in the frame and whose owner chain has no
    // in-frame link → targetLineFor returns kind:"baked", the third header.
    const out = buildTargetPreamble([pick("/kit/src/Chip.tsx", "Chip", "span")], FRAME);
    expect(out).toContain("rendered from a SHARED prototype-kit component");
    expect(isScopedEditPrompt(out)).toBe(true);
  });

  it("appended user text after the preamble is still detected", () => {
    const out =
      buildTargetPreamble([pick(`/p/frames/${FRAME}/index.tsx`, "Button", "button")], FRAME) +
      "\n\nmake this open a filter popover https://figma.com/design/x?node-id=1-2";
    expect(isScopedEditPrompt(out)).toBe(true);
  });

  it("empty batch → no preamble, not detected", () => {
    expect(buildTargetPreamble([], FRAME)).toBe("");
    expect(isScopedEditPrompt("just a plain typed prompt")).toBe(false);
  });
});
