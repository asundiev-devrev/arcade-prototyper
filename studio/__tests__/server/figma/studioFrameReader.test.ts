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

  it("recovers the Figma FILE key from the importer's own record so ids cannot collide across files", async () => {
    // Node ids are only unique WITHIN a Figma file, and multi-file projects exist on
    // disk (`polina-s-prototype` references two). Without a key, a colliding id from
    // a different file reads as an edit of the wrong frame — and the generator edits
    // it without hesitating.
    //
    // The key comes from `figma-origin.json`, which the kit-emit branch writes at
    // IMPORT time. It used to be regexed out of `LIFT.json#intentSummary`, which is
    // the project's FIRST user prompt and therefore identical for every frame — see
    // the dedicated describe block at the bottom of this file.
    writeFrame("p", "01-figma-36-7860", {
      "index.tsx": '<div data-figma-id="36:7861" />',
      "figma-origin.json": JSON.stringify({
        fileKey: "EAo4gdFvjvzXnmL8hX6Ctc",
        nodeId: "36:7860",
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

  it("leaves fileKey undefined when there is no origin record — unknown, never mismatch", async () => {
    // An LLM-authored frame was never imported, so it has no origin record — and
    // neither does any frame imported before this record existed. Provenance treats
    // a missing key as "unknown", so such a frame keeps today's behaviour instead of
    // losing provenance altogether. A WRONG key would be worse than none: it blocks
    // real hits AND invents false ones.
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

/**
 * THE FILE KEY, AGAINST THE REAL WRITER — the shape `emitLiftForFrame` actually
 * produces, not a hand-built one.
 *
 * The tests above write a per-frame `intentSummary` whose URL is that frame's own
 * import. **The real writer never produces that for frame 2+.**
 * `liftEmitPlugin.ts`'s `readFirstUserPrompt` returns the FIRST user message of
 * the whole PROJECT, so every frame in a project is labelled with the file key of
 * whatever the designer imported first — verified on disk: all three frames of the
 * live `implement-this-precisely-3` carry a byte-identical `intentSummary`,
 * including `02-figma-5678-118907`, which was imported from a different node.
 *
 * So deriving `fileKey` from `intentSummary` reports a WRONG key on a multi-file
 * project, and it fails in both directions — it suppresses genuine provenance hits
 * on later-imported files (the exact bug this branch exists to fix, on the
 * multi-file project that motivated file scoping) and it accepts a colliding id it
 * was built to reject. Both are now pinned below, against the real writer.
 */
describe("makeStudioFrameReader — fileKey, built the way liftEmitPlugin builds it", () => {
  function writeProjectHistory(projectSlug: string, userPrompts: string[]) {
    const dir = path.join(tmp, "projects", projectSlug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "chat-history.json"),
      JSON.stringify(userPrompts.map((content) => ({ role: "user", content }))),
    );
  }

  const FILE_A = "EAo4gdFvjvzXnmL8hX6Ctc";
  const FILE_B = "JztJjqt3i6uFwB6r4dfewz";

  it("does NOT stamp the project's FIRST file key onto a later frame", async () => {
    // The live `polina-s-prototype` shape: turn 1 imported from file A, turn 2 from
    // file B. `emitLiftForFrame` gives BOTH frames intentSummary = the file-A URL.
    writeProjectHistory("multi", [
      `Implement this precisely: https://www.figma.com/design/${FILE_A}/Untitled?node-id=36-7860`,
      `now this one https://www.figma.com/design/${FILE_B}/Nav?node-id=195-9587`,
    ]);
    writeFrame("multi", "01-figma-36-7860", { "index.tsx": '<div data-figma-id="36:7861" />' });
    writeFrame("multi", "02-figma-195-9587", { "index.tsx": '<div data-figma-id="195:9588" />' });

    const { emitLiftForFrame } = await import("../../../server/plugins/liftEmitPlugin");
    await emitLiftForFrame("multi", "01-figma-36-7860");
    await emitLiftForFrame("multi", "02-figma-195-9587");

    const read = makeStudioFrameReader("multi", [
      { slug: "01-figma-36-7860" },
      { slug: "02-figma-195-9587" },
    ]);
    const frames = await read();
    const second = frames.find((f) => f.slug === "02-figma-195-9587")!;
    // The whole point: frame 02 came from file B, so it must NEVER be labelled A.
    expect(second.fileKey).not.toBe(FILE_A);

    // FALSE NEGATIVE, the costly direction. The designer corrects frame 02 by
    // re-pasting a node file B really stamped there. With the wrong key this
    // returned {kind:"none"} and the turn fell back to the LLM-less importer,
    // stamping a duplicate frame — the original bug, on the one project shape
    // that motivated file scoping in the first place.
    const corrective = await locateNodeProvenance([{ nodeId: "195:9588", fileKey: FILE_B }], read);
    expect(corrective.kind).toBe("exact");
    expect(corrective.frameSlug).toBe("02-figma-195-9587");
  });

  it("still recovers the key when the importer recorded it per frame", async () => {
    // The fix's own mechanism: the importer knows the real key at write time, so it
    // is persisted per frame and the reader reads THAT. No dependence on chat
    // history, and correct on frame 2+ of a multi-file project.
    writeFrame("solo", "01-figma-36-7860", {
      "index.tsx": '<div data-figma-id="36:7861" />',
      "figma-origin.json": JSON.stringify({ fileKey: FILE_A, nodeId: "36:7860" }),
    });
    const read = makeStudioFrameReader("solo", [{ slug: "01-figma-36-7860" }]);
    expect((await read())[0].fileKey).toBe(FILE_A);

    // Same id, different file → still no match. The collision guard the module
    // documents at caveat 4 now actually guards.
    const collide = await locateNodeProvenance([{ nodeId: "36:7861", fileKey: FILE_B }], read);
    expect(collide.kind).toBe("none");
  });

  it("leaves fileKey undefined rather than guessing when nothing recorded it", async () => {
    // A frame with a LIFT.json but no per-frame origin record — every frame written
    // before this fix. `undefined` means "unknown" to provenance, which keeps
    // today's behaviour; a WRONG key both blocks real hits and invents false ones,
    // so unknown is strictly the safer default.
    writeProjectHistory("legacy", [
      `Implement this precisely: https://www.figma.com/design/${FILE_A}/Untitled?node-id=36-7860`,
    ]);
    writeFrame("legacy", "02-figma-195-9587", { "index.tsx": '<div data-figma-id="195:9588" />' });
    const { emitLiftForFrame } = await import("../../../server/plugins/liftEmitPlugin");
    await emitLiftForFrame("legacy", "02-figma-195-9587");

    const read = makeStudioFrameReader("legacy", [{ slug: "02-figma-195-9587" }]);
    expect((await read())[0].fileKey).toBeUndefined();
    // …so a corrective on that frame resolves, whatever file it is claimed from.
    const prov = await locateNodeProvenance([{ nodeId: "195:9588", fileKey: FILE_B }], read);
    expect(prov.kind).toBe("exact");
  });
});
