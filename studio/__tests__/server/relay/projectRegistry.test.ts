import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetProjectRegistryForTests,
  createOrGetProject,
  getProject,
  addCollaborator,
  removeCollaborator,
  listProjects,
  isAllowed,
  republishAllRendezvous,
} from "../../../server/relay/projectRegistry";

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

// republishAllRendezvous dynamically imports ./tunnel; mock that path so
// vi.spyOn isn't needed on a frozen ESM namespace.
const { acquireTunnelMock } = vi.hoisted(() => ({ acquireTunnelMock: vi.fn() }));
vi.mock("../../../server/relay/tunnel", () => ({
  acquireTunnel: acquireTunnelMock,
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

describe("republishAllRendezvous", () => {
  beforeEach(() => {
    __resetProjectRegistryForTests();
    acquireTunnelMock.mockReset();
    acquireTunnelMock.mockResolvedValue("https://t.trycloudflare.com");
  });

  it("acquires the tunnel for every project with shared_with > 0", async () => {
    const a = await createOrGetProject({ hostDevu: HOST, projectSlug: "a" });
    const b = await createOrGetProject({ hostDevu: HOST, projectSlug: "b" });
    await createOrGetProject({ hostDevu: HOST, projectSlug: "c" });
    await addCollaborator(a.id, { devu: GUEST, displayName: "x", addedBy: HOST });
    await addCollaborator(b.id, { devu: "don:.../devu/3", displayName: "y", addedBy: HOST });
    await republishAllRendezvous();
    expect(acquireTunnelMock).toHaveBeenCalledTimes(2);
    expect(acquireTunnelMock).toHaveBeenCalledWith(a.id);
    expect(acquireTunnelMock).toHaveBeenCalledWith(b.id);
  });

  it("does nothing when no projects are shared", async () => {
    await createOrGetProject({ hostDevu: HOST, projectSlug: "lonely" });
    await republishAllRendezvous();
    expect(acquireTunnelMock).not.toHaveBeenCalled();
  });

  it("logs and continues when one acquireTunnel rejects", async () => {
    const a = await createOrGetProject({ hostDevu: HOST, projectSlug: "a" });
    const b = await createOrGetProject({ hostDevu: HOST, projectSlug: "b" });
    await addCollaborator(a.id, { devu: GUEST, displayName: "x", addedBy: HOST });
    await addCollaborator(b.id, { devu: GUEST, displayName: "y", addedBy: HOST });
    acquireTunnelMock
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce("https://t.trycloudflare.com");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await republishAllRendezvous();
    expect(acquireTunnelMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
