import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { userKitDir, userKitCompositesDir, userKitManifestPath } from "../../server/paths";

describe("user-kit paths", () => {
  const prev = process.env.ARCADE_STUDIO_ROOT;
  afterEach(() => { process.env.ARCADE_STUDIO_ROOT = prev; });

  it("nests under the studio root", () => {
    process.env.ARCADE_STUDIO_ROOT = "/tmp/arcade-test-root";
    expect(userKitDir()).toBe(path.join("/tmp/arcade-test-root", "user-kit"));
    expect(userKitCompositesDir()).toBe(path.join("/tmp/arcade-test-root", "user-kit", "composites"));
    expect(userKitManifestPath()).toBe(path.join("/tmp/arcade-test-root", "user-kit", "manifest.json"));
  });
});
