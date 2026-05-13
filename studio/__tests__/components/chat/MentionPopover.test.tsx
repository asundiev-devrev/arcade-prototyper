// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// Mock @xorkavi/arcade-gen to avoid gridstack ESM resolution issues pulled in
// via the Dashboard re-export. MentionPopover only needs `Computer`.
vi.mock("@xorkavi/arcade-gen", () => ({
  Computer: () => null,
}));

import { filterMentions } from "../../../src/components/chat/MentionPopover";

describe("filterMentions", () => {
  it("returns the Computer option when the query is empty", () => {
    const results = filterMentions("", []);
    expect(results.map((r) => r.id)).toContain("computer");
  });

  it("returns Computer and user matches for partial queries", () => {
    const users = [
      { id: "devu/1", displayName: "Alice", email: "alice@devrev.ai" },
      { id: "devu/2", displayName: "Konstantin", email: "k@devrev.ai" },
    ];
    const results = filterMentions("Ko", users);
    expect(results.map((r) => r.id)).toEqual(["devu/2"]);
  });

  it("matches by email prefix as well as display name", () => {
    const users = [
      { id: "devu/1", displayName: "Alice", email: "alice@devrev.ai" },
    ];
    const results = filterMentions("alic", users);
    expect(results.map((r) => r.id)).toEqual(["devu/1"]);
  });

  it("caps user results to 8 to keep the popover compact", () => {
    const users = Array.from({ length: 20 }, (_, i) => ({
      id: `devu/${i}`,
      displayName: `User ${i}`,
      email: `user${i}@devrev.ai`,
    }));
    const results = filterMentions("user", users);
    // Computer doesn't match "user", so just user results:
    expect(results).toHaveLength(8);
  });
});
