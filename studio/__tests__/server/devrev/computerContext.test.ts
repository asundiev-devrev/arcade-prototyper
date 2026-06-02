import { describe, it, expect } from "vitest";
import { buildComputerContext, COMPUTER_CONTEXT_BUDGET } from "../../../server/devrev/computerContext";

describe("buildComputerContext", () => {
  it("includes all four sections when present", () => {
    const out = buildComputerContext({
      projectSummary: "Project: Helpdesk. Goal: triage screen.",
      pendingChimeIns: ["Tickets don't auto-close like that."],
      frameSource: "### frame: 01-x\n\n```tsx\nexport default ()=>null\n```",
      recentHistory: [
        { role: "user", content: "build a triage screen" },
        { role: "assistant", content: "Done." },
      ],
    });
    expect(out).toContain("Helpdesk");
    expect(out).toContain("auto-close");
    expect(out).toContain("01-x");
    expect(out).toContain("triage screen");
  });

  it("omits empty sections without throwing", () => {
    const out = buildComputerContext({
      projectSummary: "Project: Empty.",
      pendingChimeIns: [],
      frameSource: "",
      recentHistory: [],
    });
    expect(out).toContain("Empty");
    expect(out).not.toContain("Recent conversation");
    expect(out).not.toContain("Open product-truth notes");
  });

  it("stays under budget by trimming history first", () => {
    const huge = Array.from({ length: 5000 }, (_, i) => ({
      role: "user" as const,
      content: `line ${i} ${"x".repeat(40)}`,
    }));
    const out = buildComputerContext({
      projectSummary: "Project: Big.",
      pendingChimeIns: [],
      frameSource: "### frame: 01\n\n```tsx\n" + "y".repeat(2000) + "\n```",
      recentHistory: huge,
    });
    expect(out.length).toBeLessThanOrEqual(COMPUTER_CONTEXT_BUDGET);
    expect(out).toContain("Big");
    expect(out).toContain("frame: 01");
  });
});
