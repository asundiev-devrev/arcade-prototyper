import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadSessions,
  saveSessions,
} from "../../../server/relay/persistence";
import type { SessionState } from "../../../server/relay/types";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-relay-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeSession(id: string): SessionState {
  return {
    id,
    sessionObject: `relay-${id}`,
    hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
    projectSlug: "demo",
    linkedWorkId: null,
    createdAt: new Date().toISOString(),
    endedAt: null,
    invites: [],
  };
}

describe("relay persistence", () => {
  it("loadSessions returns an empty array when the file does not exist", async () => {
    const sessions = await loadSessions();
    expect(sessions).toEqual([]);
  });

  it("saveSessions creates the multiplayer dir and writes the file", async () => {
    await saveSessions([makeSession("abc")]);
    const file = path.join(tmp, "multiplayer", "sessions.json");
    expect(fs.existsSync(file)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.sessions).toHaveLength(1);
    expect(raw.sessions[0].id).toBe("abc");
  });

  it("round-trips sessions via save + load", async () => {
    const before = [makeSession("a"), makeSession("b")];
    await saveSessions(before);
    const after = await loadSessions();
    expect(after).toEqual(before);
  });

  it("ignores a corrupted file and returns empty instead of throwing", async () => {
    const file = path.join(tmp, "multiplayer", "sessions.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{{{not valid json");
    const result = await loadSessions();
    expect(result).toEqual([]);
  });

  it("rejects a file with a future version it doesn't understand", async () => {
    const file = path.join(tmp, "multiplayer", "sessions.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 99, sessions: [] }));
    const result = await loadSessions();
    expect(result).toEqual([]);
  });

  it("writes atomically (tmp file is removed on success)", async () => {
    await saveSessions([makeSession("x")]);
    const dir = path.join(tmp, "multiplayer");
    const tmpFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);
  });
});
