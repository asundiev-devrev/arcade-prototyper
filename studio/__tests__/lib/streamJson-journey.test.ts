import { describe, it, expect } from "vitest";
import { parseStreamLineAll, type StudioEvent } from "../../src/lib/streamJson";

function asAssistantText(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

describe("parseStreamLineAll: journey sentinel", () => {
  it("emits a single journey event for a fully-sentineled single-line block", () => {
    const events = parseStreamLineAll(asAssistantText("→ Scanning the design system"));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Scanning the design system" },
    ]);
  });

  it("emits one journey event per sentineled line", () => {
    const events = parseStreamLineAll(
      asAssistantText("→ Scanning the design system\n→ Reading the navigation pattern\n→ Sketching the page body"),
    );
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Scanning the design system" },
      { kind: "journey", text: "Reading the navigation pattern" },
      { kind: "journey", text: "Sketching the page body" },
    ]);
  });

  it("emits a single narration event for a fully un-sentineled block (regression)", () => {
    const events = parseStreamLineAll(
      asAssistantText("Built the navigation and breadcrumb from the kit.\n\n### Deviations\n\nNone."),
    );
    expect(events).toEqual<StudioEvent[]>([
      { kind: "narration", text: "Built the navigation and breadcrumb from the kit.\n\n### Deviations\n\nNone." },
    ]);
  });

  it("splits mixed blocks: journey lines first, then a single narration with the un-sentineled remainder", () => {
    const text = "→ Scanning the design system\n→ Reading the navigation pattern\nBuilt the navigation and breadcrumb from the kit.\n\n### Deviations\n\nNone.";
    const events = parseStreamLineAll(asAssistantText(text));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Scanning the design system" },
      { kind: "journey", text: "Reading the navigation pattern" },
      { kind: "narration", text: "Built the navigation and breadcrumb from the kit.\n\n### Deviations\n\nNone." },
    ]);
  });

  it("strips leading ASCII spaces/tabs before testing the sentinel", () => {
    const events = parseStreamLineAll(asAssistantText("   → Polishing spacing\n\t→ Choosing colors"));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Polishing spacing" },
      { kind: "journey", text: "Choosing colors" },
    ]);
  });

  it("does not treat markdown blockquote sentinels as journey lines", () => {
    const events = parseStreamLineAll(asAssistantText("> → not a journey line\nActual narration."));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "narration", text: "> → not a journey line\nActual narration." },
    ]);
  });

  it("does not treat sentinel mid-line as a journey line", () => {
    const events = parseStreamLineAll(asAssistantText("Some prose with → an arrow inside."));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "narration", text: "Some prose with → an arrow inside." },
    ]);
  });

  it("trims trailing whitespace from the journey text", () => {
    const events = parseStreamLineAll(asAssistantText("→ Sketching the page body   "));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Sketching the page body" },
    ]);
  });

  it("ignores blank lines in the un-sentineled portion when nothing remains after stripping journey lines", () => {
    const events = parseStreamLineAll(asAssistantText("→ Scanning the design system\n\n\n"));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Scanning the design system" },
    ]);
  });

  it("preserves blank lines INSIDE the un-sentineled remainder", () => {
    const events = parseStreamLineAll(asAssistantText("→ Sketching\nLine A.\n\nLine B."));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Sketching" },
      { kind: "narration", text: "Line A.\n\nLine B." },
    ]);
  });
});
