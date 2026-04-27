// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  handleViteError,
  parseBuildError,
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
    expect(call.prompt.toLowerCase()).toContain("smallest thing");
  });
});
