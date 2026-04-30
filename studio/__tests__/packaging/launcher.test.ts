import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const launcher = path.resolve(__dirname, "..", "..", "packaging", "launcher.sh");

describe("launcher.sh", () => {
  it("exists and is executable", () => {
    expect(existsSync(launcher)).toBe(true);
    const mode = statSync(launcher).mode & 0o111;
    expect(mode).not.toBe(0);
  });

  it("resolves bundle root from BASH_SOURCE", () => {
    expect(readFileSync(launcher, "utf-8")).toContain("BASH_SOURCE");
  });

  it("exports bundled Node on PATH", () => {
    const content = readFileSync(launcher, "utf-8");
    // Lock down both the variable definition and its use on PATH.
    expect(content).toMatch(/NODE_BIN="[^"]*node\/bin"/);
    expect(content).toMatch(/export PATH="\$NODE_BIN/);
  });

  it("puts node_modules/.bin on PATH so figmanage resolves", () => {
    expect(readFileSync(launcher, "utf-8")).toMatch(/node_modules\/\.bin/);
  });

  it("short-circuits when port 5556 is already in use", () => {
    const body = readFileSync(launcher, "utf-8");
    expect(body).toContain("5556");
    expect(body).toMatch(/lsof.*5556/);
  });

  it("logs to ~/Library/Logs/arcade-studio.log", () => {
    const content = readFileSync(launcher, "utf-8");
    // The launcher splits path construction: LOG_DIR="$HOME/Library/Logs"
    // and LOG_FILE="$LOG_DIR/arcade-studio.log". Assert both pieces plus
    // that LOG_FILE is used to mean "we really log here".
    expect(content).toMatch(/LOG_DIR="[^"]*Library\/Logs"/);
    expect(content).toMatch(/LOG_FILE="\$LOG_DIR\/arcade-studio\.log"/);
  });

  it("invokes vite's JS entry, not the shell-script wrapper in .bin/", () => {
    const content = readFileSync(launcher, "utf-8");
    // Regression guard: feeding `node_modules/.bin/vite` to node crashes with
    // "SyntaxError: missing ) after argument list" because .bin/vite is a
    // bash wrapper, not JS. Must call vite.js directly instead.
    //
    // To allow the explanatory comment in the launcher to mention ".bin/vite"
    // without tripping the negative assertion, check only non-comment lines.
    const codeLines = content
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(codeLines).toMatch(/node_modules\/vite\/bin\/vite\.js/);
    expect(codeLines).not.toMatch(/node.*node_modules\/\.bin\/vite\b/);
  });

  it("verifies the port responds before short-circuiting a relaunch", () => {
    // Regression guard: an old version only checked `lsof`, which is true
    // even when Vite has crashed and left a zombie on the port. Users saw
    // "You can't open the application because it is not responding" because
    // the short-circuit opened a browser against a dead server. Now we do
    // an HTTP health check with curl before short-circuiting.
    const content = readFileSync(launcher, "utf-8");
    expect(content).toMatch(/curl.*localhost:5556/);
  });

  it("kills stale processes holding port 5556 when the server is unhealthy", () => {
    // Regression guard: the sequence of "close browser tab → quit Dock
    // icon" left Vite orphaned holding port 5556. Next launch hit the
    // short-circuit and opened a browser to a dead server. The launcher
    // now kills anything still bound to 5556 before starting fresh.
    const content = readFileSync(launcher, "utf-8");
    expect(content).toMatch(/lsof -ti:5556/);
    // Must actually kill, not just detect.
    expect(content).toMatch(/xargs kill/);
  });

  it("installs a cleanup trap that runs on exit AND on signals", () => {
    // Regression guard: a plain `trap ... TERM INT` missed HUP (sent when
    // the controlling terminal goes away, e.g. the app window is killed
    // by macOS) and EXIT (normal shutdown). Missing traps leave Vite
    // orphaned. All four must be covered.
    const content = readFileSync(launcher, "utf-8");
    expect(content).toMatch(/trap\s+\S+\s+TERM\s+INT\s+HUP\s+EXIT/);
  });

  it("kills the whole Vite process tree, not just the parent PID", () => {
    // Regression guard: Vite spawns watcher + helper subprocesses. If we
    // only `kill $VITE_PID`, children survive and keep port 5556 bound.
    // pkill -P sends the signal to all children of $VITE_PID.
    const content = readFileSync(launcher, "utf-8");
    expect(content).toMatch(/pkill .*-P\s+"?\$VITE_PID/);
  });
});
