// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { checkForUpdate } from "../../../server/middleware/version";

function fakeFetch(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throws?: unknown;
}): typeof fetch {
  return vi.fn(async () => {
    if (response.throws) throw response.throws;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
    } as unknown as Response;
  });
}

const validRelease = {
  tag_name: "v0.4.5",
  html_url: "https://github.com/example/arcade-prototyper/releases/tag/v0.4.5",
  published_at: "2026-05-02T00:00:00Z",
  body: "### Added\n- stuff",
  assets: [
    { name: "Arcade Studio 0.4.5.dmg", browser_download_url: "https://cdn/0.4.5.dmg" },
    { name: "sources.tar.gz", browser_download_url: "https://cdn/sources.tar.gz" },
  ],
};

describe("checkForUpdate", () => {
  it("reports an update when the latest tag is ahead of current", async () => {
    const result = await checkForUpdate("0.4.4", fakeFetch({ body: validRelease }));
    expect(result.upToDate).toBe(false);
    expect(result.latest).toBe("0.4.5");
    expect(result.downloadUrl).toBe("https://cdn/0.4.5.dmg");
    expect(result.releaseNotes).toContain("stuff");
  });

  it("reports up-to-date when current matches latest", async () => {
    const result = await checkForUpdate("0.4.5", fakeFetch({ body: validRelease }));
    expect(result.upToDate).toBe(true);
    expect(result.latest).toBe("0.4.5");
  });

  it("reports up-to-date when current is ahead of latest (local dirty build)", async () => {
    const result = await checkForUpdate("0.4.6", fakeFetch({ body: validRelease }));
    expect(result.upToDate).toBe(true);
  });

  it("treats 'dev' current as up-to-date", async () => {
    const result = await checkForUpdate("dev", fakeFetch({ body: validRelease }));
    expect(result.upToDate).toBe(true);
  });

  it("strips a leading 'v' from the tag", async () => {
    const result = await checkForUpdate("0.4.4", fakeFetch({
      body: { ...validRelease, tag_name: "v0.4.5" },
    }));
    expect(result.latest).toBe("0.4.5");
  });

  it("accepts tags without a leading 'v'", async () => {
    const result = await checkForUpdate("0.4.4", fakeFetch({
      body: { ...validRelease, tag_name: "0.4.5" },
    }));
    expect(result.latest).toBe("0.4.5");
  });

  it("picks the .dmg asset even when other assets are listed first", async () => {
    const reordered = {
      ...validRelease,
      assets: [
        { name: "sources.tar.gz", browser_download_url: "https://cdn/sources.tar.gz" },
        { name: "Arcade Studio 0.4.5.dmg", browser_download_url: "https://cdn/0.4.5.dmg" },
      ],
    };
    const result = await checkForUpdate("0.4.4", fakeFetch({ body: reordered }));
    expect(result.downloadUrl).toBe("https://cdn/0.4.5.dmg");
  });

  it("returns downloadUrl = null when no .dmg asset is attached", async () => {
    const assetless = { ...validRelease, assets: [] };
    const result = await checkForUpdate("0.4.4", fakeFetch({ body: assetless }));
    expect(result.upToDate).toBe(false);
    expect(result.downloadUrl).toBeNull();
    expect(result.releaseUrl).toContain("/releases/tag/");
  });

  it("returns an unknown-but-safe result on GitHub 404 (no public release yet)", async () => {
    const result = await checkForUpdate("0.4.4", fakeFetch({ ok: false, status: 404 }));
    expect(result.unknown).toBe(true);
    expect(result.upToDate).toBe(true); // never nag the user on uncertainty
    expect(result.latest).toBeNull();
  });

  it("returns an unknown-but-safe result on network error", async () => {
    const result = await checkForUpdate("0.4.4", fakeFetch({ throws: new Error("ECONNREFUSED") }));
    expect(result.unknown).toBe(true);
    expect(result.upToDate).toBe(true);
  });

  it("returns an unknown-but-safe result when tag_name is missing", async () => {
    const result = await checkForUpdate("0.4.4", fakeFetch({
      body: { ...validRelease, tag_name: undefined },
    }));
    expect(result.unknown).toBe(true);
    expect(result.upToDate).toBe(true);
  });
});
