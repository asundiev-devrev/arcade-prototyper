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

// Static source assertions — a cheap structural net only.
//
// These CANNOT see semantics: an inverted, deleted or awaited gate satisfies
// every `toContain` below. The behaviour is asserted against a real turn in
// `__tests__/server/middleware/chat-memory-writes.test.ts` — the flag in both
// directions, the per-turn cap, the fence exemption, the journey seam, and that
// an unwritable store still ends the turn cleanly. Keep both files.
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
    // Semantics — both directions of the gate — live in chat-memory-writes.
    expect(src).toContain("ARCADE_MEMORY_CAPTURE");
  });

  it("caps the whole turn, not just one narration message", () => {
    // extractProposedMemories caps per call; chat.ts accumulates across many.
    expect(src).toContain("capProposalsPerTurn");
  });

  it("captures fire-and-forget, never awaiting the turn on it", () => {
    // A failure to remember must not delay or break the designer's turn.
    // Both halves matter: the `void` call must be present AND no `await` form
    // may exist — `void` surviving only in a comment used to satisfy this.
    expect(src).toContain("void recordProposedMemories(");
    expect(src).not.toMatch(/await\s+recordProposedMemories\s*\(/);
  });

  it("does not clear the session on a memory write", () => {
    const block = src.slice(src.indexOf("recordProposedMemories"));
    expect(block.slice(0, 800)).not.toContain("clearAllProjectSessions");
  });

  it("exempts a bare remember: turn from BOTH false-alarm trailers", () => {
    // A `remember:` turn is instructed to acknowledge + emit a sentinel and
    // nothing else: no frame write, no Deviations section. Both trailers fire on
    // exactly that shape, so without the exemption a successful memory turn
    // reported itself as two failures — including the red no-frame-changes
    // banner. isMemoryOnlyPrompt was previously wired ONLY into the phantom-edit
    // retry gate, which suppressed the re-run but not the warnings.
    expect(src).toContain("const memoryOnlyTurn = isMemoryOnlyPrompt(ctx.prompt)");
    expect(src).toMatch(/if \(joined && !memoryOnlyTurn && !hasDeviationsSection\(joined\)\)/);
    expect(src).toMatch(/if \(!memoryOnlyTurn && !hasAnyChange\(diff\)\)/);
  });
});
