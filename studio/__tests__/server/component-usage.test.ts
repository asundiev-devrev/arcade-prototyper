// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findComponentUsages } from "../../server/componentUsage";

async function writeFrame(root: string, slug: string, frame: string, src: string) {
  const dir = path.join(root, "projects", slug, "frames", frame);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.tsx"), src, "utf-8");
}

describe("findComponentUsages", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-"));
    process.env.ARCADE_STUDIO_ROOT = root;
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("finds frames importing the component by specifier", async () => {
    await writeFrame(root, "proj-a", "01-home",
      `import { PriceTag } from "arcade-user/PriceTag";\nexport default () => <PriceTag/>;`);
    await writeFrame(root, "proj-b", "02-detail",
      `import { PriceTag } from "arcade-user/PriceTag";\nexport default () => <div><PriceTag/></div>;`);
    // A frame that does NOT use it.
    await writeFrame(root, "proj-a", "03-other",
      `export default () => <div>nothing</div>;`);

    const usages = await findComponentUsages("PriceTag");
    const keys = usages.map((u) => `${u.slug}/${u.frameSlug}`).sort();
    expect(keys).toEqual(["proj-a/01-home", "proj-b/02-detail"]);
  });

  it("does not match a different component whose name is a prefix", async () => {
    await writeFrame(root, "proj-a", "01-home",
      `import { PriceTagPro } from "arcade-user/PriceTagPro";\nexport default () => <PriceTagPro/>;`);
    const usages = await findComponentUsages("PriceTag");
    expect(usages).toEqual([]);
  });

  it("returns empty when no frames exist", async () => {
    expect(await findComponentUsages("PriceTag")).toEqual([]);
  });

  it("finds the import in a NESTED sub-file, not just index.tsx", async () => {
    // Multi-file frame: index.tsx does NOT import it, a pages/ sub-file does.
    // This is the real-world shape that blanked a frame on delete.
    const frameDir = path.join(root, "projects", "proj-a", "frames", "01-settings");
    await fs.mkdir(path.join(frameDir, "pages"), { recursive: true });
    await fs.writeFile(path.join(frameDir, "index.tsx"),
      `import { Page } from "./pages/MyPage";\nexport default () => <Page/>;`, "utf-8");
    await fs.writeFile(path.join(frameDir, "pages", "MyPage.tsx"),
      `import { OauthTitle } from "arcade-user/OauthTitle";\nexport const Page = () => <OauthTitle/>;`, "utf-8");

    const usages = await findComponentUsages("OauthTitle");
    expect(usages.map((u) => `${u.slug}/${u.frameSlug}`)).toEqual(["proj-a/01-settings"]);
  });

  it("returns ONE entry per frame even when multiple sub-files import it", async () => {
    const frameDir = path.join(root, "projects", "proj-a", "frames", "01-multi");
    await fs.mkdir(path.join(frameDir, "pages"), { recursive: true });
    await fs.writeFile(path.join(frameDir, "index.tsx"),
      `import { PriceTag } from "arcade-user/PriceTag";\nexport default () => <PriceTag/>;`, "utf-8");
    await fs.writeFile(path.join(frameDir, "pages", "A.tsx"),
      `import { PriceTag } from "arcade-user/PriceTag";\nexport const A = () => <PriceTag/>;`, "utf-8");
    await fs.writeFile(path.join(frameDir, "pages", "B.tsx"),
      `import { PriceTag } from "arcade-user/PriceTag";\nexport const B = () => <PriceTag/>;`, "utf-8");

    const usages = await findComponentUsages("PriceTag");
    expect(usages.map((u) => `${u.slug}/${u.frameSlug}`)).toEqual(["proj-a/01-multi"]);
  });

  it("skips non-slug sibling dirs (e.g. _figma-ingest) without throwing", async () => {
    // projectDir() throws on these names; the scan must tolerate them.
    await fs.mkdir(path.join(root, "projects", "_figma-ingest", "frames"), { recursive: true });
    await fs.mkdir(path.join(root, "projects", "uploads-staging"), { recursive: true });
    await writeFrame(root, "proj-a", "01-home",
      `import { PriceTag } from "arcade-user/PriceTag";\nexport default () => <PriceTag/>;`);

    const usages = await findComponentUsages("PriceTag");
    expect(usages.map((u) => `${u.slug}/${u.frameSlug}`)).toEqual(["proj-a/01-home"]);
  });
});
