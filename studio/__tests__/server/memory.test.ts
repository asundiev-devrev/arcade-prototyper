import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureMemoryStubs } from "../../server/memory";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-memory-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ensureMemoryStubs", () => {
  it("creates the dir and both stub files when absent", async () => {
    const dir = path.join(tmp, "memory");
    await ensureMemoryStubs(dir, "global");
    expect(fs.existsSync(path.join(dir, "RULES.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "LEARNED.md"))).toBe(true);
  });

  it("scope label appears in the stub header", async () => {
    const dir = path.join(tmp, "memory");
    await ensureMemoryStubs(dir, "this project");
    const rules = fs.readFileSync(path.join(dir, "RULES.md"), "utf-8");
    expect(rules).toContain("this project");
  });

  it("does not overwrite an edited file (idempotent)", async () => {
    const dir = path.join(tmp, "memory");
    await ensureMemoryStubs(dir, "global");
    const learned = path.join(dir, "LEARNED.md");
    fs.writeFileSync(learned, "- prefers teal accents <!-- 2026-06-04 -->\n");
    await ensureMemoryStubs(dir, "global");
    expect(fs.readFileSync(learned, "utf-8")).toBe(
      "- prefers teal accents <!-- 2026-06-04 -->\n",
    );
  });
});
