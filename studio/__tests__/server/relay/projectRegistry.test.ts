import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetProjectRegistryForTests,
  createOrGetProject,
  getProject,
  addCollaborator,
  removeCollaborator,
  listProjects,
  isAllowed,
} from "../../../server/relay/projectRegistry";

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

beforeEach(() => __resetProjectRegistryForTests());

const HOST = "don:identity:dvrv-us-1:devo/0:devu/1";
const GUEST = "don:identity:dvrv-us-1:devo/0:devu/2";

describe("projectRegistry", () => {
  it("createOrGetProject returns a record with empty allowlist", async () => {
    const p = await createOrGetProject({ hostDevu: HOST, projectSlug: "my-proj" });
    expect(p.hostDevu).toBe(HOST);
    expect(p.projectSlug).toBe("my-proj");
    expect(p.shared_with).toEqual([]);
    expect(p.id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("createOrGetProject is idempotent per (host, slug)", async () => {
    const a = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    const b = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    expect(a.id).toBe(b.id);
  });

  it("addCollaborator adds an entry; re-adding is a no-op", async () => {
    const p = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    await addCollaborator(p.id, { devu: GUEST, displayName: "Bea", addedBy: HOST });
    await addCollaborator(p.id, { devu: GUEST, displayName: "Bea", addedBy: HOST });
    const refreshed = getProject(p.id)!;
    expect(refreshed.shared_with).toHaveLength(1);
    expect(refreshed.shared_with[0]?.devu).toBe(GUEST);
  });

  it("removeCollaborator deletes an entry", async () => {
    const p = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    await addCollaborator(p.id, { devu: GUEST, displayName: "Bea", addedBy: HOST });
    await removeCollaborator(p.id, GUEST);
    expect(getProject(p.id)!.shared_with).toEqual([]);
  });

  it("isAllowed returns true for host and listed devus, false for everyone else", async () => {
    const p = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    await addCollaborator(p.id, { devu: GUEST, displayName: "Bea", addedBy: HOST });
    expect(isAllowed(p.id, HOST)).toBe(true);
    expect(isAllowed(p.id, GUEST)).toBe(true);
    expect(isAllowed(p.id, "don:.../devu/999")).toBe(false);
  });

  it("listProjects returns only projects for the given host", async () => {
    const a = await createOrGetProject({ hostDevu: HOST, projectSlug: "a" });
    await createOrGetProject({ hostDevu: "don:.../devu/3", projectSlug: "b" });
    const list = listProjects({ hostDevu: HOST });
    expect(list.map((p) => p.id)).toEqual([a.id]);
  });
});
