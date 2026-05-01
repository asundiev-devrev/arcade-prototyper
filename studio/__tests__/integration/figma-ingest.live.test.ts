import { describe, it, expect } from "vitest";
import { getFigmaIngest } from "../../server/figmaIngest";

const SHOULD_RUN = process.env.FIGMA_LIVE_TESTS === "1";
const d = SHOULD_RUN ? describe : describe.skip;

d("live figma ingest (FIGMA_LIVE_TESTS=1)", () => {
  it("ingests a real Figma node end-to-end", async () => {
    const fileKey = process.env.FIGMA_LIVE_FILE_KEY;
    const nodeId = process.env.FIGMA_LIVE_NODE_ID;
    if (!fileKey || !nodeId) {
      throw new Error("set FIGMA_LIVE_FILE_KEY and FIGMA_LIVE_NODE_ID");
    }
    const ingest = await getFigmaIngest();
    const outcome = await ingest.ingest(
      fileKey,
      nodeId,
      `https://figma.com/design/${fileKey}/?node-id=${nodeId.replace(":", "-")}`,
    );
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.tree).toBeDefined();
    expect(outcome.source.fileKey).toBe(fileKey);
  }, 30_000);
});
