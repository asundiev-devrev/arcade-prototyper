// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  handleViteError,
  parseBuildError,
  buildAutoFixPrompt,
  lastAttempt,
  AUTO_RETRY_WINDOW_MS,
} from "../../server/buildErrorReporter";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-ber-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  lastAttempt.clear();
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
  lastAttempt.clear();
  vi.restoreAllMocks();
});

function seedProject(slug: string, frameName: string) {
  const projectDir = path.join(tmp, "projects", slug);
  const frameDir = path.join(projectDir, "frames", frameName);
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, "index.tsx"), `export default () => <div/>;`);
  const project = {
    name: slug,
    slug,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    theme: "arcade" as const,
    mode: "light" as const,
    frames: [],
  };
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(project));
  return path.join(frameDir, "index.tsx");
}

function errPayload(file: string, message = "Unexpected token") {
  return { err: { message, loc: { file } } };
}

describe("parseBuildError", () => {
  const root = "/tmp/root";

  it("returns null for payload without file", () => {
    expect(parseBuildError({ err: { message: "x" } }, root)).toBeNull();
    expect(parseBuildError({}, root)).toBeNull();
    expect(parseBuildError(null, root)).toBeNull();
  });

  it("returns null for files outside projectsRoot", () => {
    expect(parseBuildError(errPayload("/somewhere/else/file.tsx"), root)).toBeNull();
  });

  it("returns null for paths without a `frames` segment", () => {
    expect(parseBuildError(errPayload(path.join(root, "slug", "shared", "foo.tsx")), root)).toBeNull();
    expect(parseBuildError(errPayload(path.join(root, "slug", "index.tsx")), root)).toBeNull();
  });

  it("extracts slug and frameName for a valid frame path", () => {
    const file = path.join(root, "my-slug", "frames", "welcome", "index.tsx");
    expect(parseBuildError(errPayload(file, "boom"), root)).toEqual({
      slug: "my-slug",
      frameName: "welcome",
      message: "boom",
    });
  });

  it("falls back to 'unknown build error' when err.message is missing", () => {
    const file = path.join(root, "my-slug", "frames", "welcome", "index.tsx");
    const parsed = parseBuildError({ err: { loc: { file } } }, root);
    expect(parsed?.message).toBe("unknown build error");
  });

  it("treats non-string file values as invalid", () => {
    expect(parseBuildError({ err: { loc: { file: 42 } } }, root)).toBeNull();
    expect(parseBuildError({ err: { loc: { file: undefined } } }, root)).toBeNull();
  });

  // Regression: Vite 8 (rolldown-vite) uses the oxc transformer. A frame with a
  // JS/JSX syntax error throws a `[plugin:vite:oxc]` error whose shape is
  // { errors, plugin: "vite:oxc", id: "<abs file>", pluginCode } — `loc` is
  // UNDEFINED and the file path lives in `err.id`, not `err.loc.file`.
  // (Shape captured live from vite@8.0.13, not assumed.) Before the fix,
  // parseBuildError read only loc.file, returned null → the auto-fix never
  // fired for parse errors, so a syntax-broken frame stranded the user while
  // the agent chased unrelated import false-positives.
  it("extracts the frame from an oxc error that carries the path in err.id", () => {
    const file = path.join(root, "topics", "frames", "01-topics-computer", "index.tsx");
    const oxcPayload = {
      err: {
        plugin: "vite:oxc",
        id: file,
        message:
          "Transform failed with 1 error:\n[PARSE_ERROR] Unterminated regular expression",
      },
    };
    expect(parseBuildError(oxcPayload, root)).toEqual({
      slug: "topics",
      frameName: "01-topics-computer",
      message:
        "Transform failed with 1 error:\n[PARSE_ERROR] Unterminated regular expression",
    });
  });

  it("strips ANSI color codes from the oxc message", () => {
    const file = path.join(root, "topics", "frames", "welcome", "index.tsx");
    const parsed = parseBuildError(
      { err: { id: file, message: "[31m[PARSE_ERROR][0m boom" } },
      root,
    );
    expect(parsed?.message).toBe("[PARSE_ERROR] boom");
  });

  it("prefers loc.file when both loc.file and id are present", () => {
    const locFile = path.join(root, "topics", "frames", "welcome", "index.tsx");
    const parsed = parseBuildError(
      { err: { loc: { file: locFile }, id: "/somewhere/else.tsx", message: "x" } },
      root,
    );
    expect(parsed?.frameName).toBe("welcome");
  });
});

describe("handleViteError", () => {
  it("rate-limits a second trigger within the window", async () => {
    const file = seedProject("demo", "welcome");
    const runTurn = vi.fn().mockResolvedValue(undefined);
    const now = vi.fn().mockReturnValue(1_000_000);

    const first = await handleViteError(errPayload(file), { runTurn, now });
    expect(first).toBe("dispatched");
    expect(runTurn).toHaveBeenCalledTimes(1);

    // 30s later, still inside the window -> skipped
    now.mockReturnValue(1_000_000 + 30_000);
    const second = await handleViteError(errPayload(file), { runTurn, now });
    expect(second).toBe("skipped:rate-limited");
    expect(runTurn).toHaveBeenCalledTimes(1);

    // Just past the window -> dispatched again
    now.mockReturnValue(1_000_000 + AUTO_RETRY_WINDOW_MS + 1);
    const third = await handleViteError(errPayload(file), { runTurn, now });
    expect(third).toBe("dispatched");
    expect(runTurn).toHaveBeenCalledTimes(2);
  });

  it("ignores files outside projectsRoot", async () => {
    const runTurn = vi.fn();
    const outside = path.join(os.tmpdir(), "not-a-studio-project", "foo.tsx");
    const result = await handleViteError(errPayload(outside), { runTurn });
    expect(result).toBe("skipped:not-frame");
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("ignores rel paths without a `frames` segment", async () => {
    // A file directly under the project dir, not under frames/
    const badFile = path.join(tmp, "projects", "demo", "shared", "helper.tsx");
    fs.mkdirSync(path.dirname(badFile), { recursive: true });
    fs.writeFileSync(badFile, "");

    const runTurn = vi.fn();
    const result = await handleViteError(errPayload(badFile), { runTurn });
    expect(result).toBe("skipped:not-frame");
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("does not throw when runClaudeTurn rejects", async () => {
    const file = seedProject("demo", "welcome");
    const runTurn = vi.fn().mockRejectedValue(new Error("claude blew up"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(handleViteError(errPayload(file), { runTurn })).resolves.toBe("skipped:error");
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it("returns 'skipped:no-project' when the project can't be loaded", async () => {
    // Create a frame file whose slug has no project.json sibling.
    const frameDir = path.join(tmp, "projects", "ghost", "frames", "welcome");
    fs.mkdirSync(frameDir, { recursive: true });
    const file = path.join(frameDir, "index.tsx");
    fs.writeFileSync(file, "");

    const runTurn = vi.fn();
    const result = await handleViteError(errPayload(file), { runTurn });
    expect(result).toBe("skipped:no-project");
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("posts user-facing system messages on dispatch and on completion", async () => {
    // Regression for the "silent self-healing" UX bug: when a frame trips
    // FrameErrorBoundary or Vite's compile-time path, the studio dispatches
    // an auto-fix turn under the hood. Pre-fix the user just saw a red
    // stack-trace wall + nothing in chat — they couldn't tell whether the
    // tool was doing anything. Now the dispatcher appends two system-role
    // chat messages (start + done) so the chat carries a breadcrumb.
    const file = seedProject("demo", "welcome");
    const runTurn = vi.fn().mockResolvedValue(undefined);
    const writes: Array<{ slug: string; msg: { role: string; content: string } }> = [];
    const writeHistory = vi.fn(async (slug: string, msg: any) => {
      writes.push({ slug, msg });
    });

    const result = await handleViteError(errPayload(file, "boom"), {
      runTurn,
      appendHistory: writeHistory,
    });
    expect(result).toBe("dispatched");

    // Three writes: start banner, raw-error detail row, done banner.
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes[0].slug).toBe("demo");
    expect(writes[0].msg.role).toBe("system");
    expect(writes[0].msg.content.toLowerCase()).toContain("auto-repair");
    expect(writes[0].msg.content).toContain("welcome");
    const last = writes[writes.length - 1];
    expect(last.msg.role).toBe("system");
    expect(last.msg.content.toLowerCase()).toContain("auto-repair");
    expect(last.msg.content.toLowerCase()).toContain("finished");
  });

  it("posts a failure system message when the auto-fix turn rejects", async () => {
    const file = seedProject("demo", "welcome");
    const runTurn = vi.fn().mockRejectedValue(new Error("claude blew up"));
    const writes: Array<{ msg: { role: string; content: string } }> = [];
    const writeHistory = vi.fn(async (_slug: string, msg: any) => {
      writes.push({ msg });
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await handleViteError(errPayload(file, "boom"), {
      runTurn,
      appendHistory: writeHistory,
    });
    expect(result).toBe("skipped:error");
    const last = writes[writes.length - 1];
    expect(last.msg.role).toBe("system");
    expect(last.msg.content.toLowerCase()).toContain("couldn't run");
  });

  it("passes session id and a compact fix prompt to runClaudeTurn", async () => {
    const file = seedProject("demo", "welcome");
    // Inject a sessionId by rewriting project.json.
    const pjPath = path.join(tmp, "projects", "demo", "project.json");
    const pj = JSON.parse(fs.readFileSync(pjPath, "utf-8"));
    pj.sessionId = "sess-42";
    fs.writeFileSync(pjPath, JSON.stringify(pj));

    const runTurn = vi.fn().mockResolvedValue(undefined);
    const resolveBin = () => "/fake/bin/claude";
    const result = await handleViteError(errPayload(file, "ReferenceError: x"), {
      runTurn,
      resolveBin,
    });

    expect(result).toBe("dispatched");
    expect(runTurn).toHaveBeenCalledTimes(1);
    const call = runTurn.mock.calls[0][0];
    expect(call.bin).toBe("/fake/bin/claude");
    expect(call.sessionId).toBe("sess-42");
    expect(call.cwd).toBe(path.join(tmp, "projects", "demo"));
    expect(call.prompt).toContain("welcome");
    expect(call.prompt).toContain("ReferenceError: x");
    expect(call.prompt.toLowerCase()).toContain("smallest change");
  });
});

describe("buildAutoFixPrompt", () => {
  // Regression: implement-this-precisely. A scoped edit added a filter menu with
  // a hallucinated icon reference → the frame crashed with "Element type is
  // invalid … got: undefined". Auto-repair ran with the old one-liner ("fix the
  // smallest thing that resolves it") and the agent took the LITERALLY smallest
  // path: it deleted the broken references — icon → empty <span/>, checkmark →
  // "+" text. The crash went away but the user lost the UI they asked for.
  // These pin that the prompt now forbids delete-to-green and, for the
  // undefined-element class, points the agent at the import/name as the cause.
  it("forbids deleting UI or swapping in placeholders to silence the error", () => {
    const prompt = buildAutoFixPrompt("runtime", "welcome", "some error");
    const lc = prompt.toLowerCase();
    expect(lc).toContain("preserve");
    // Names the exact vandalism we observed so the agent recognises it.
    expect(lc).toContain("placeholder");
    expect(prompt).toContain("<span/>");
    expect(lc).toMatch(/do not delete|don't delete|not to delete/);
    // Still asks for a minimal, non-restructuring change.
    expect(lc).toContain("smallest change");
    expect(lc).toContain("do not restructure");
  });

  it("for an undefined-element crash, tells the agent to fix the import/name (not strip JSX)", () => {
    const msg =
      "Element type is invalid: expected a string (for built-in components) or a " +
      "class/function (for composite components) but got: undefined.";
    const prompt = buildAutoFixPrompt("runtime", "01-figma-8139-41293", msg);
    const lc = prompt.toLowerCase();
    expect(lc).toContain("import");
    // The frame name and raw message are still carried through.
    expect(prompt).toContain("01-figma-8139-41293");
    expect(prompt).toContain("got: undefined");
    // Directs to the barrel as the source of the correct name.
    expect(lc).toContain("barrel");
  });

  it("omits the import-specific guidance for unrelated crash classes", () => {
    const prompt = buildAutoFixPrompt("runtime", "welcome", "Cannot read properties of null");
    // The undefined-element paragraph should not fire for a null-deref.
    expect(prompt).not.toContain("Element type is invalid");
    // But the preserve-UI rule always applies.
    expect(prompt.toLowerCase()).toContain("preserve");
  });

  it("labels build vs runtime errors distinctly", () => {
    const build = buildAutoFixPrompt("build", "welcome", "boom");
    const runtime = buildAutoFixPrompt("runtime", "welcome", "boom");
    expect(build.toLowerCase()).toContain("failing to build");
    expect(runtime.toLowerCase()).toContain("threw a runtime error");
  });
});
