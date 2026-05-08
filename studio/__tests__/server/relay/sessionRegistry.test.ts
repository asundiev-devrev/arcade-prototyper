import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSession,
  getSession,
  listSessions,
  endSession,
  addInvite,
  __resetSessionRegistryForTests,
  hydrateSessionRegistry,
} from "../../../server/relay/sessionRegistry";

let tmp: string;
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-relay-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  __resetSessionRegistryForTests();
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sessionRegistry", () => {
  it("creates a session with a unique session_object and returns the state", async () => {
    const s = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "demo",
    });
    expect(s.id).toBeTruthy();
    expect(s.sessionObject).toMatch(/^relay-session-/);
    expect(s.hostDevu).toBe("don:identity:dvrv-us-1:devo/0:devu/1");
    expect(s.endedAt).toBeNull();
    expect(s.invites).toEqual([]);
  });

  it("persists the session so it survives a registry reset", async () => {
    const s = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "demo",
    });
    __resetSessionRegistryForTests();
    await hydrateSessionRegistry();
    expect(getSession(s.id)?.id).toBe(s.id);
  });

  it("listSessions excludes ended sessions by default", async () => {
    const a = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "a",
    });
    const b = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "b",
    });
    await endSession(a.id);
    const active = listSessions();
    expect(active.map((s) => s.id)).toEqual([b.id]);
  });

  it("addInvite appends to the invite list and persists", async () => {
    const s = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "demo",
    });
    await addInvite(s.id, {
      devu: "don:identity:dvrv-us-1:devo/0:devu/2",
      invitedByDevu: s.hostDevu,
    });
    expect(getSession(s.id)?.invites).toHaveLength(1);
  });

  it("addInvite is idempotent for the same devu", async () => {
    const s = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "demo",
    });
    await addInvite(s.id, { devu: "x", invitedByDevu: s.hostDevu });
    await addInvite(s.id, { devu: "x", invitedByDevu: s.hostDevu });
    expect(getSession(s.id)?.invites).toHaveLength(1);
  });

  it("endSession is a no-op for an unknown id", async () => {
    await expect(endSession("nonexistent")).resolves.not.toThrow();
  });
});
