// @vitest-environment node
//
// The ONE Studio-only piece of the Figma turn-routing feature: the adapter that
// implements the `FrameSourceReader` seam over Studio's filesystem. Everything else
// in the feature is brain (provenance / turnConstraints / turnRouting /
// turnDirectives) and is guarded against ever importing a Studio path.
//
// It gets its own tests because it carries the failure modes a stub reader cannot:
// non-index `.tsx` files, file-key recovery from LIFT.json, and unreadable /
// oversized files. `import-hook-dead-in-dmg` is the cautionary case — a reader that
// looked in a dev-only place passed every test and was dead on tester machines.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { makeStudioFrameReader } from "../../../server/figma/adapters/studioFrameReader";
import { locateNodeProvenance } from "../../../server/figma/provenance";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-frame-reader-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeFrame(
  projectSlug: string,
  frameSlug: string,
  files: Record<string, string>,
): string {
  const dir = path.join(tmp, "projects", projectSlug, "frames", frameSlug);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

describe("makeStudioFrameReader", () => {
  it("reads index.tsx and reports the frame slug", async () => {
    writeFrame("p", "01-figma-5678-118876", {
      "index.tsx": 'export default () => <div data-figma-id="5678:118877" />;',
    });
    const frames = await makeStudioFrameReader("p", [{ slug: "01-figma-5678-118876" }])();
    expect(frames.length).toBe(1);
    expect(frames[0].slug).toBe("01-figma-5678-118876");
    expect(frames[0].source).toContain('data-figma-id="5678:118877"');
  });

  it("reads EVERY *.tsx in the frame dir, not just index.tsx", async () => {
    // The wire branch writes the overlay design as a sibling `Overlay.tsx` through
    // the same stamping emitter (chat.ts passes `entryFileName`), and 11 non-index
    // `.tsx` files exist inside live frame dirs today. An index-only reader would
    // miss an overlay node entirely, the turn would fall back to the importer, and a
    // new frame would be stamped — the original bug, on the branch that most needs
    // provenance because the designer is mid-iteration.
    writeFrame("p", "01-figma-3814-30541", {
      "index.tsx": "export default () => <div />;",
      "Overlay.tsx": 'export default () => <div data-figma-id="3814:99999" />;',
    });
    const read = makeStudioFrameReader("p", [{ slug: "01-figma-3814-30541" }]);
    const frames = await read();
    expect(frames.length).toBe(2);
    // Both entries carry the FRAME slug, so they collapse to ONE candidate rather
    // than registering as ambiguous with themselves.
    expect(new Set(frames.map((f) => f.slug)).size).toBe(1);
    const prov = await locateNodeProvenance(["3814:99999"], read);
    expect(prov.kind).toBe("exact");
    expect(prov.frameSlug).toBe("01-figma-3814-30541");
  });

  it("recovers the Figma FILE key from LIFT.json so ids cannot collide across files", async () => {
    // Node ids are only unique WITHIN a Figma file, and multi-file projects exist on
    // disk (`polina-s-prototype` references two). Without a key, a colliding id from
    // a different file reads as an edit of the wrong frame — and the generator edits
    // it without hesitating.
    writeFrame("p", "01-figma-36-7860", {
      "index.tsx": '<div data-figma-id="36:7861" />',
      "LIFT.json": JSON.stringify({
        intentSummary:
          "Implement this precisely: https://www.figma.com/design/EAo4gdFvjvzXnmL8hX6Ctc/Untitled?node-id=36-7860",
      }),
    });
    const read = makeStudioFrameReader("p", [{ slug: "01-figma-36-7860" }]);
    const frames = await read();
    expect(frames[0].fileKey).toBe("EAo4gdFvjvzXnmL8hX6Ctc");
    // Same id, DIFFERENT file → no match.
    const other = await locateNodeProvenance(
      [{ nodeId: "36:7861", fileKey: "JztJjqt3i6uFwB6r4dfewz" }],
      read,
    );
    expect(other.kind).toBe("none");
    // Same id, same file → match.
    const same = await locateNodeProvenance(
      [{ nodeId: "36:7861", fileKey: "EAo4gdFvjvzXnmL8hX6Ctc" }],
      read,
    );
    expect(same.kind).toBe("exact");
  });

  it("leaves fileKey undefined when there is no LIFT.json — unknown, never mismatch", async () => {
    // An LLM-authored frame has no LIFT.json. Provenance treats a missing key as
    // "unknown", so such a frame keeps today's behaviour instead of losing
    // provenance altogether.
    writeFrame("p", "01-hand-written", { "index.tsx": '<div data-figma-id="1:2" />' });
    const read = makeStudioFrameReader("p", [{ slug: "01-hand-written" }]);
    const frames = await read();
    expect(frames[0].fileKey).toBeUndefined();
    const prov = await locateNodeProvenance([{ nodeId: "1:2", fileKey: "anything" }], read);
    expect(prov.kind).toBe("exact");
  });

  it("recovers the origin node id from an importer-written slug", async () => {
    // The frame's own ROOT node id is never in its source — verified live, `grep -o
    // '5678[:-]118876' index.tsx` returns nothing, because the outer wrapper is a
    // plain position:relative div. Re-pasting the original URL is an ordinary
    // designer move, so it has to be recoverable from the slug.
    writeFrame("p", "02-figma-5678-118907", { "index.tsx": "<div />" });
    const frames = await makeStudioFrameReader("p", [{ slug: "02-figma-5678-118907" }])();
    expect(frames[0].importedFromNodeId).toBe("5678:118907");
  });

  it("leaves importedFromNodeId undefined for a non-importer slug", async () => {
    writeFrame("p", "01-settings-page", { "index.tsx": "<div />" });
    const frames = await makeStudioFrameReader("p", [{ slug: "01-settings-page" }])();
    expect(frames[0].importedFromNodeId).toBeUndefined();
  });

  it("skips a missing frame dir without throwing", async () => {
    // The project record and the disk can disagree (a frame deleted by hand). A
    // provenance failure must never fail a turn.
    writeFrame("p", "01-real", { "index.tsx": "<div />" });
    const frames = await makeStudioFrameReader("p", [
      { slug: "01-real" },
      { slug: "02-does-not-exist" },
    ])();
    expect(frames.map((f) => f.slug)).toEqual(["01-real"]);
  });

  it("skips a file over 1MB rather than scanning it", async () => {
    // A designer with 30 frames must not pay an unbounded scan, and a pathological
    // generated file should be skipped rather than block the turn.
    writeFrame("p", "01-huge", {
      "index.tsx": `// ${"x".repeat(1_000_001)}`,
      "Small.tsx": '<div data-figma-id="9:9" />',
    });
    const frames = await makeStudioFrameReader("p", [{ slug: "01-huge" }])();
    expect(frames.length).toBe(1);
    expect(frames[0].source).toContain("9:9");
  });

  it("ignores non-tsx files in the frame dir", async () => {
    writeFrame("p", "01-x", {
      "index.tsx": "<div />",
      "LIFT.xml": "<lift/>",
      "styles.css": ".a{}",
    });
    const frames = await makeStudioFrameReader("p", [{ slug: "01-x" }])();
    expect(frames.length).toBe(1);
  });

  it("survives a slug the paths layer rejects", async () => {
    // frameDir() validates the slug shape and THROWS on a bad one. The reader must
    // skip it, not reject — a rejecting reader is treated as "no signal" by
    // provenance, which would silently lose the signal for every OTHER frame too.
    writeFrame("p", "01-good", { "index.tsx": '<div data-figma-id="1:1" />' });
    const frames = await makeStudioFrameReader("p", [
      { slug: "../../../etc" },
      { slug: "01-good" },
    ])();
    expect(frames.map((f) => f.slug)).toEqual(["01-good"]);
  });

  it("returns [] for a project with no frames, and never rejects", async () => {
    await expect(makeStudioFrameReader("p", [])()).resolves.toEqual([]);
    await expect(makeStudioFrameReader("no-such-project", [{ slug: "01-x" }])()).resolves.toEqual([]);
  });
});
