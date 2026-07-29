import { describe, it, expect } from "vitest";
import { parseStreamLineAll, type StudioEvent } from "../../src/lib/streamJson";
import { MEMORY_SENTINEL } from "../../server/memoryContract";

/** A memory line smuggled behind the journey marker. */
const MEMORY_SENTINEL_LINE = `→ ${MEMORY_SENTINEL} project | journey-smuggled fact`;

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

  it("skips bare sentinel lines (no text after the sentinel) instead of emitting an empty journey", () => {
    const events = parseStreamLineAll(asAssistantText("→ Sketching\n→ \n→ Done"));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Sketching" },
      { kind: "journey", text: "Done" },
    ]);
  });

  it("skips sentinel lines whose only content after the sentinel is whitespace", () => {
    const events = parseStreamLineAll(asAssistantText("→ \t\n→ Real"));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Real" },
    ]);
  });

  // Regression: a memory-proposal line that ALSO carries the journey marker used
  // to become a `journey` event. Journey events bypass the memory seam in
  // chat.ts, so the plumbing line rendered to the designer verbatim AND the fact
  // was never recorded. It belongs on the narration side, which is the one path
  // that runs the seam.
  it("routes a `→ ⟐ remember:` line to narration, not to a journey", () => {
    const events = parseStreamLineAll(
      asAssistantText(`${MEMORY_SENTINEL_LINE}\n→ Sketching\nBuilt the page.`),
    );
    expect(events).toEqual<StudioEvent[]>([
      { kind: "journey", text: "Sketching" },
      {
        kind: "narration",
        text: `${MEMORY_SENTINEL} project | journey-smuggled fact\nBuilt the page.`,
      },
    ]);
    // No journey event carries the sentinel.
    for (const ev of events) {
      if (ev.kind === "journey") expect(ev.text).not.toContain("⟐");
    }
  });

  it("keeps the memory line out of journeys even when it is the only line", () => {
    const events = parseStreamLineAll(asAssistantText(MEMORY_SENTINEL_LINE));
    expect(events).toEqual<StudioEvent[]>([
      { kind: "narration", text: `${MEMORY_SENTINEL} project | journey-smuggled fact` },
    ]);
  });
});
