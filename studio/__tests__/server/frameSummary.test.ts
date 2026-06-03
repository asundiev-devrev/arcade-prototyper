import { describe, it, expect } from "vitest";
import { summarizeFrameSource } from "../../server/frameSummary";

const SAMPLE = `import * as React from "react";
import {
  ComputerSidebar,
  ComputerHeader,
  ChatInput,
} from "arcade-prototypes";
import { IconButton, ChatBubble } from "arcade/components";

export default function WelcomeFrame() {
  return (
    <div className="flex">
      <ComputerSidebar />
      <ComputerHeader title="Welcome back" />
      <ChatBubble>How can I help you today?</ChatBubble>
      <IconButton aria-label="Close" />
    </div>
  );
}`;

describe("summarizeFrameSource", () => {
  it("names the frame", () => {
    const out = summarizeFrameSource("01-welcome", SAMPLE);
    expect(out).toContain("01-welcome");
  });

  it("lists the imported composite/components, not raw code", () => {
    const out = summarizeFrameSource("01-welcome", SAMPLE);
    expect(out).toContain("ComputerSidebar");
    expect(out).toContain("ChatInput");
    expect(out).toContain("IconButton");
    // It must NOT echo raw JSX/className soup.
    expect(out).not.toContain('className="flex"');
    expect(out).not.toContain("export default function");
  });

  it("captures visible text content", () => {
    const out = summarizeFrameSource("01-welcome", SAMPLE);
    expect(out).toContain("Welcome back");
    expect(out).toContain("How can I help you today?");
  });

  it("is dramatically smaller than the source", () => {
    const out = summarizeFrameSource("01-welcome", SAMPLE);
    expect(out.length).toBeLessThan(SAMPLE.length);
  });

  it("handles empty / junk input without throwing", () => {
    expect(summarizeFrameSource("x", "")).toContain("x");
    expect(() => summarizeFrameSource("x", "not real code {{{")).not.toThrow();
  });

  it("caps a pathologically large frame", () => {
    const huge = `import { A } from "arcade/components";\n` + 'const t = "' + "x".repeat(50_000) + '";';
    const out = summarizeFrameSource("big", huge);
    expect(out.length).toBeLessThan(2_500);
  });
});
