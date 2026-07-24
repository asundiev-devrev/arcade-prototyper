// @vitest-environment node
//
// A scoped edit can reference MORE THAN ONE Figma design ("make this open a
// popover <url A> and show selected chips in the toolbar <url B>"). The earlier
// enrichment read only the FIRST url, so the agent never saw design B and
// invented it — the "chips break the layout" bug. This pins that every
// referenced node gets its own <figma_context> block + reference PNG.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as ingestModule from "../../../server/figmaIngest";
import { enrichPromptWithFigmaContext } from "../../../server/middleware/chat";
import type { IngestResult } from "../../../server/figma/types";

const URL_A = "https://www.figma.com/design/kJc/AS?node-id=8172-33651";
const URL_B = "https://www.figma.com/design/kJc/AS?node-id=8140-33699";

function fakeResult(nodeId: string, pngPath: string): IngestResult {
  return {
    source: { fileKey: "kJc", nodeId, url: `u:${nodeId}`, fetchedAt: "t" } as any,
    png: { path: pngPath, widthPx: 100, heightPx: 100 },
    tree: { id: nodeId, type: "frame", name: `node-${nodeId}` } as any,
    tokens: { colors: {}, typography: {}, spacing: {} },
    composites: [],
    classified: true,
    diagnostics: { warnings: [] },
  };
}

// getCached is keyed by (fileId, nodeId) — return a distinct result per node so
// we can prove BOTH designs were pulled in.
function mockIngestPerNode() {
  const byNode: Record<string, IngestResult> = {
    "8172:33651": fakeResult("8172:33651", "/tmp/popover.png"),
    "8140:33699": fakeResult("8140:33699", "/tmp/toolbar.png"),
  };
  vi.spyOn(ingestModule, "getFigmaIngest").mockResolvedValue({
    getCached: (_fileId: string, nodeId: string) => byNode[nodeId],
    getPhase1Pending: () => undefined,
    ingestPhase1: async () => ({ ok: false, reason: "unused" }),
    ingest: async () => ({ ok: false, reason: "unused" }),
    getRawNode: () => undefined,
  } as any);
}

beforeEach(() => mockIngestPerNode());
afterEach(() => vi.restoreAllMocks());

describe("enrichPromptWithFigmaContext — multiple reference URLs", () => {
  it("attaches a <figma_context> block for EACH referenced node", async () => {
    const prompt =
      'Make "All Knowledge" open a popover ' + URL_A +
      " and show selected chips in the toolbar " + URL_B;
    const { prompt: out } = await enrichPromptWithFigmaContext(prompt, []);
    const blocks = out.match(/<figma_context url=/g) ?? [];
    expect(blocks.length).toBe(2);
    // Each design's own url is present in its block (buildFigmaContextBlock
    // stamps r.source.url).
    expect(out).toContain("u:8172:33651");
    expect(out).toContain("u:8140:33699");
  });

  it("attaches the reference PNG for EVERY design, not just the first", async () => {
    const prompt = "open " + URL_A + " and also " + URL_B;
    const { images } = await enrichPromptWithFigmaContext(prompt, []);
    expect(images).toContain("/tmp/popover.png");
    expect(images).toContain("/tmp/toolbar.png");
    expect(images.length).toBe(2);
  });

  it("is unchanged for a single-URL prompt (one block, one PNG)", async () => {
    const { prompt: out, images } = await enrichPromptWithFigmaContext("open " + URL_A, []);
    expect((out.match(/<figma_context url=/g) ?? []).length).toBe(1);
    expect(images).toEqual(["/tmp/popover.png"]);
  });

  it("is a no-op when the prompt has no Figma URL", async () => {
    const { prompt: out, images } = await enrichPromptWithFigmaContext("make the title red", ["x.png"]);
    expect(out).toBe("make the title red");
    expect(images).toEqual(["x.png"]);
  });
});
