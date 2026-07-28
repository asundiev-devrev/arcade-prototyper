// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHAT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "server",
  "middleware",
  "chat.ts",
);

// Static source assertions: exercising a full turn needs a live claude
// subprocess. The units are covered in memoryContract/memoryCapture tests; what
// matters here is that chat.ts wires them at the right seam.
describe("chat.ts — memory capture wiring", () => {
  const src = fs.readFileSync(CHAT, "utf-8");

  it("strips memory lines from narration before persisting", () => {
    expect(src).toContain("stripMemoryLines");
  });

  it("records proposed memories post-turn", () => {
    expect(src).toContain("recordProposedMemories");
    expect(src).toContain("extractProposedMemories");
  });

  it("honours the rollout flag", () => {
    expect(src).toContain("ARCADE_MEMORY_CAPTURE");
  });

  it("captures fire-and-forget, never awaiting the turn on it", () => {
    // A failure to remember must not delay or break the designer's turn.
    expect(src).toMatch(/void recordProposedMemories|recordProposedMemories\([\s\S]{0,400}?\)\s*\.catch/);
  });

  it("does not clear the session on a memory write", () => {
    const block = src.slice(src.indexOf("recordProposedMemories"));
    expect(block.slice(0, 800)).not.toContain("clearAllProjectSessions");
  });
});
