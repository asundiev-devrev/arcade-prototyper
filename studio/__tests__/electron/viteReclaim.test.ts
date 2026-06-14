import { describe, it, expect } from "vitest";
import { isArcadeViteCommand, parseLsofListeners } from "../../../electron/viteRunner";

describe("isArcadeViteCommand", () => {
  it("matches a packaged-app Vite child (vite.js + our config)", () => {
    const cmd =
      "/Applications/Arcade Studio.app/Contents/Resources/app/node_modules/vite/bin/vite.js --config studio/vite.config.ts";
    expect(isArcadeViteCommand(cmd)).toBe(true);
  });

  it("matches a `pnpm run studio` dev server Vite child", () => {
    const cmd =
      "node /Users/x/arcade-prototyper/node_modules/.pnpm/vite@8.0.13/node_modules/vite/bin/vite.js --config studio/vite.config.ts";
    expect(isArcadeViteCommand(cmd)).toBe(true);
  });

  it("does NOT match an unrelated vite serving a different config", () => {
    const cmd = "node /some/other/project/node_modules/vite/bin/vite.js --config vite.config.ts";
    expect(isArcadeViteCommand(cmd)).toBe(false);
  });

  it("does NOT match a random non-vite process that happens to mention studio", () => {
    const cmd = "node /Users/x/server.js --root studio/vite.config.ts.bak";
    // No vite entry → not ours.
    expect(isArcadeViteCommand(cmd)).toBe(false);
  });

  it("does NOT match a foreign server with no vite + no config", () => {
    expect(isArcadeViteCommand("/usr/bin/python3 -m http.server 5556")).toBe(false);
  });

  it("is false for empty / undefined-ish input", () => {
    expect(isArcadeViteCommand("")).toBe(false);
  });
});

describe("parseLsofListeners", () => {
  it("pairs each pid with its command from lsof -F output", () => {
    const out = "p99298\ncnode\np68621\ncArcade Studio\n";
    expect(parseLsofListeners(out)).toEqual([
      { pid: 99298, command: "node" },
      { pid: 68621, command: "Arcade Studio" },
    ]);
  });

  it("returns empty for empty output (nothing listening / lsof failed)", () => {
    expect(parseLsofListeners("")).toEqual([]);
  });

  it("ignores command lines with no preceding pid", () => {
    expect(parseLsofListeners("cstray\n")).toEqual([]);
  });

  it("handles a single listener", () => {
    expect(parseLsofListeners("p123\ncnode\n")).toEqual([{ pid: 123, command: "node" }]);
  });
});
