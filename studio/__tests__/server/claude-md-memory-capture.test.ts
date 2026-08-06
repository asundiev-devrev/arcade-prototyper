// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_SENTINEL, extractProposedMemories } from "../../server/memoryContract";

const TPL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
  "CLAUDE.md.tpl",
);

describe("CLAUDE.md template — memory capture", () => {
  const tpl = fs.readFileSync(TPL, "utf-8");

  it("uses the same sentinel the server parses", () => {
    // If these drift, the agent proposes and nothing is ever recorded.
    expect(tpl).toContain(MEMORY_SENTINEL);
  });

  it("makes the memory step part of the required response shape", () => {
    const shape = tpl.slice(
      tpl.indexOf("## Response shape"),
      tpl.indexOf("## Design system"),
    );
    expect(shape).toContain(MEMORY_SENTINEL);
  });

  it("still forbids the agent editing memory files itself", () => {
    expect(tpl).toMatch(/read-only to you/);
  });

  it("no longer tells the designer to add rules by hand for remember:", () => {
    // Studio captures now; sending them to the panel was the honest stopgap
    // while nothing wrote memory, and is now wrong.
    expect(tpl).not.toMatch(/tell them to add it under/i);
  });

  it("tells the agent to record only durable preferences, not this-frame tweaks", () => {
    expect(tpl).toMatch(/durable/i);
  });

  it("keeps the deviations contract intact", () => {
    expect(tpl).toMatch(/### Deviations/);
  });

  // --- Regression: the prompt must not teach a line that records garbage ---
  // The template has to SHOW the line's shape, so its example text is fed to
  // the real parser here. An example that parses is an example the agent can
  // parrot into permanent memory.
  it("teaches an example that the real parser refuses to record", () => {
    const captured = extractProposedMemories(tpl);
    expect(captured).toEqual([]);
  });

  it("tells the agent the angle brackets are placeholders, not literal text", () => {
    expect(tpl).toMatch(/placeholder/i);
  });

  // --- Regression: routing must match the measured spec (project-default) ---
  // The spec measured the real corpus: every recurring corrective theme lived
  // in exactly ONE project. A first-sight "is this about their taste?" test
  // routes those global on turn 1, and one experiment's conventions then apply
  // as house style to every future project — the exact pain this feature
  // exists to remove.
  describe("global/project routing copy", () => {
    const shape = tpl.slice(tpl.indexOf("## Response shape"), tpl.indexOf("## Design system"));

    it("makes global require cross-project evidence, not a taste judgement", () => {
      // `[\W]*` tolerates the markdown emphasis around "different".
      expect(shape).toMatch(/different\W+project/i);
    });

    it("does not tell the agent that general taste or conventions mean global", () => {
      // The rejected copy: "Use `global` when it is about how this designer
      // works in general (their taste, their conventions…)".
      expect(shape).not.toMatch(/use `global` when it is about how this designer works in general/i);
    });

    it("still says project is the answer when unsure", () => {
      expect(shape).toMatch(/doubt[^.]*`project`|unsure[^.]*`project`/i);
    });
  });
});

// --- Regression: the prompt must not go live ahead of its stripper ---
// The template promises the memory line "is stripped before the designer sees
// your reply". `refreshStaleClaudeMd()` rewrites every existing project's
// CLAUDE.md on boot, so the moment this template ships, agents start emitting
// the sentinel. If chat.ts is not stripping it at the narration seam, the line
// reaches the chat pane AND chat-history.json — both halves of the SILENT
// constraint broken, with no code defect, purely task ordering.
describe("the promise the template makes is kept by chat.ts", () => {
  const CHAT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "server",
    "middleware",
    "chat.ts",
  );
  const tpl = fs.readFileSync(TPL, "utf-8");
  const chat = fs.readFileSync(CHAT, "utf-8");

  it("the template claims the line is stripped", () => {
    expect(tpl).toMatch(/stripped before the designer sees/i);
  });

  it("chat.ts actually strips it", () => {
    expect(chat).toContain("stripMemoryLines");
  });

  it("strips at the narration seam, not post-turn", () => {
    // Post-turn stripping is too late for the live pane: the SSE `narration`
    // event has already reached the designer's screen. Every narration handler
    // that pushes to narrationTexts must go through the harvest helper.
    const handlers = chat.match(/if \(ev\.kind === "narration"\)[\s\S]{0,400}/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) {
      expect(h).toContain("harvestMemoryLines");
    }
  });

  it("emits the stripped text, never the raw event", () => {
    // `emit(ev)` on a narration event would ship the sentinel to the pane even
    // with narrationTexts cleaned.
    expect(chat).toMatch(/emit\(\{ \.\.\.ev, text: kept \}\)/);
  });
});
