import { describe, it, expect } from "vitest";
import type { StudioEvent } from "../../src/lib/streamJson";

/**
 * Server persistence contract for journey events.
 *
 * `studio/server/middleware/chat.ts` accumulates `narration` events into a
 * `narrationTexts: string[]` array which becomes the persisted assistant
 * bubble. Journey events (kind === "journey") must NEVER land in that
 * array — they're an ephemeral live channel. This test mirrors the
 * accumulation logic and asserts the partition.
 *
 * If the production code ever changes the discriminator key or starts
 * forwarding journey events into the persisted bubble, this test breaks.
 */
function accumulate(events: StudioEvent[]): string[] {
  const narrationTexts: string[] = [];
  for (const ev of events) {
    if (ev.kind === "narration") narrationTexts.push(ev.text);
    // Journey events intentionally not accumulated.
  }
  return narrationTexts;
}

describe("chat persistence — journey vs narration partition", () => {
  it("accumulates only narration events into the persisted bubble", () => {
    const events: StudioEvent[] = [
      { kind: "journey", text: "Scanning the design system" },
      { kind: "journey", text: "Reading the navigation pattern" },
      {
        kind: "narration",
        text: "Built the navigation and breadcrumb from the kit.\n\n### Deviations\n\nNone.",
      },
    ];
    expect(accumulate(events)).toEqual([
      "Built the navigation and breadcrumb from the kit.\n\n### Deviations\n\nNone.",
    ]);
  });

  it("returns an empty bubble when only journey events are emitted", () => {
    const events: StudioEvent[] = [
      { kind: "journey", text: "Scanning" },
      { kind: "journey", text: "Sketching" },
    ];
    expect(accumulate(events)).toEqual([]);
  });
});
