import { describe, it, expect } from "vitest";
import { resolveDistinctId } from "../../../src/lib/telemetry/identity";

describe("resolveDistinctId", () => {
  it("returns persisted id when already set", async () => {
    const id = await resolveDistinctId({
      readSettings: async () => ({ telemetry: { distinctId: "alice@devrev.ai" } }),
      writeDistinctId: async () => {}, resolveEmail: async () => null, genUuid: () => "uuid-x",
    });
    expect(id).toBe("alice@devrev.ai");
  });
  it("uses DevRev email when no persisted id", async () => {
    const writes: string[] = [];
    const id = await resolveDistinctId({
      readSettings: async () => ({}), writeDistinctId: async (v) => { writes.push(v); },
      resolveEmail: async () => "bob@devrev.ai", genUuid: () => "uuid-x",
    });
    expect(id).toBe("bob@devrev.ai");
    expect(writes).toEqual(["bob@devrev.ai"]);
  });
  it("falls back to anonymous uuid when no email", async () => {
    const writes: string[] = [];
    const id = await resolveDistinctId({
      readSettings: async () => ({}), writeDistinctId: async (v) => { writes.push(v); },
      resolveEmail: async () => null, genUuid: () => "anon-uuid-1",
    });
    expect(id).toBe("anon-uuid-1");
    expect(writes).toEqual(["anon-uuid-1"]);
  });
});
