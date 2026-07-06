// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cleanProjectJson } from "../../server/projectBundle";
import type { Project } from "../../server/types";

const base: Project = {
  name: "My Project", slug: "my-project",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  theme: "arcade", mode: "light",
  frames: [{ slug: "01-home", name: "Home", size: "1440", createdAt: "2026-01-01T00:00:00.000Z" }],
  chimeIns: [],
};

describe("cleanProjectJson", () => {
  it("strips per-machine fields and resets chimeIns", () => {
    const dirty: Project = {
      ...base,
      sessionId: "sess-123",
      computerConversationId: "conv-xyz",
      deployments: [{ frameSlug: "01-home", url: "https://x", createdAt: "2026-01-01T00:00:00.000Z" }],
      chimeIns: [{ id: "c1", frameSlug: "01-home", status: "pending", message: "hi", createdAt: "2026-01-01T00:00:00.000Z" } as any],
    };
    const clean = cleanProjectJson(dirty);
    expect(clean.sessionId).toBeUndefined();
    expect(clean.computerConversationId).toBeUndefined();
    expect(clean.deployments).toBeUndefined();
    expect(clean.chimeIns).toEqual([]);
    expect(clean.name).toBe("My Project");
    expect(clean.theme).toBe("arcade");
    expect(clean.mode).toBe("light");
    expect(clean.frames).toHaveLength(1);
  });
  it("does not mutate the input", () => {
    const input: Project = { ...base, sessionId: "keep" };
    cleanProjectJson(input);
    expect(input.sessionId).toBe("keep");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach } from "vitest";
import { resolveComponentDeps } from "../../server/projectBundle";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-bundle-"));
  process.env.ARCADE_STUDIO_ROOT = root;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

function writeComposite(name: string, body: string) {
  const dir = path.join(root, "user-kit", "composites");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.tsx`), body);
}
function writeFrame(framesDir: string, frameSlug: string, body: string) {
  const dir = path.join(framesDir, frameSlug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.tsx"), body);
}

describe("resolveComponentDeps", () => {
  it("follows frame -> composite -> composite transitively", async () => {
    writeComposite("PriceTag", `export function PriceTag() { return null; }\nexport default PriceTag;`);
    writeComposite("AppCard", `import { PriceTag } from "arcade-user/PriceTag";\nexport function AppCard() { return null; }\nexport default AppCard;`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { AppCard } from "arcade-user/AppCard";\nexport default function F() { return null; }`);

    const { names, missing } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["AppCard", "PriceTag"]);
    expect(missing).toEqual([]);
  });

  it("terminates on a composite import cycle and collects both", async () => {
    writeComposite("Aa", `import { Bb } from "arcade-user/Bb";\nexport default function Aa(){return null;}`);
    writeComposite("Bb", `import { Aa } from "arcade-user/Aa";\nexport default function Bb(){return null;}`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { Aa } from "arcade-user/Aa";`);
    const { names } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["Aa", "Bb"]);
  });

  it("reports referenced-but-absent components as missing, not found", async () => {
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { Ghost } from "arcade-user/Ghost";`);
    const { names, missing } = await resolveComponentDeps(framesDir);
    expect(names).toEqual([]);
    expect(missing).toEqual(["Ghost"]);
  });

  it("does not match substrings (arcade-user/Foo vs FooBar)", async () => {
    writeComposite("FooBar", `export default function FooBar() { return null; }`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { FooBar } from "arcade-user/FooBar";`);
    const { names } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["FooBar"]); // not "Foo"
  });
});

import { packProject } from "../../server/projectBundle";
import { createProject } from "../../server/projects";
import { execFileSync } from "node:child_process";

describe("packProject", () => {
  it("produces a .arcade tar with a clean project and used components, minus excluded files", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-home-"));
    const proj = await createProject({ name: "Pack Me", theme: "arcade", mode: "light" });
    const pdir = path.join(root, "projects", proj.slug);
    fs.mkdirSync(path.join(pdir, "frames", "01-home"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "frames", "01-home", "index.tsx"),
      `import { Badge } from "arcade-user/Badge";\nexport default function F(){return null;}`);
    const cdir = path.join(root, "user-kit", "composites");
    fs.mkdirSync(cdir, { recursive: true });
    fs.writeFileSync(path.join(cdir, "Badge.tsx"), `export default function Badge(){return null;}`);
    // stuff that must NOT ship
    fs.writeFileSync(path.join(pdir, "chat-history.json"), `[{"secret":"nope"}]`);
    fs.mkdirSync(path.join(pdir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "memory", "LEARNED.md"), "private");

    const { filePath, warnings } = await packProject(proj.slug);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(warnings).toEqual([]);

    const listing = execFileSync("/usr/bin/tar", ["tzf", filePath], { encoding: "utf-8" });
    expect(listing).toMatch(/manifest\.json/);
    expect(listing).toMatch(/project\/frames\/01-home\/index\.tsx/);
    expect(listing).toMatch(/components\/Badge\.tsx/);
    expect(listing).not.toMatch(/chat-history\.json/);
    expect(listing).not.toMatch(/memory\//);
    expect(listing).not.toMatch(/CLAUDE\.md/);
  });

  it("records missing components as a warning without failing", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-home2-"));
    const proj = await createProject({ name: "Ghosty", theme: "arcade", mode: "light" });
    const pdir = path.join(root, "projects", proj.slug);
    fs.mkdirSync(path.join(pdir, "frames", "01-x"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "frames", "01-x", "index.tsx"),
      `import { Ghost } from "arcade-user/Ghost";`);
    const { warnings } = await packProject(proj.slug);
    expect(warnings.join(" ")).toMatch(/Ghost/);
  });
});

import { assertNoLinks, extractBundle, probeBundle, installBundledComponents, uniqueComponentName, rewriteSpecifier } from "../../server/projectBundle";
import { componentExists, writeComponentRaw } from "../../server/componentStore";

describe("component install (specifier-only, order-independent)", () => {
  it("installs a brand-new component", async () => {
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp-"));
    fs.writeFileSync(path.join(compDir, "Fresh.tsx"), `export default function Fresh(){return null;}`);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames-"));
    await installBundledComponents(compDir, [{ name: "Fresh", description: "d", origin: "imported", createdAt: "t" }], framesRoot);
    expect(await componentExists("Fresh")).toBe(true);
  });

  it("installs transitive deps regardless of alphabetical order (AppCard before PriceTag)", async () => {
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp-t-"));
    fs.writeFileSync(path.join(compDir, "AppCard.tsx"), `import { PriceTag } from "arcade-user/PriceTag";\nexport default function AppCard(){return null;}`);
    fs.writeFileSync(path.join(compDir, "PriceTag.tsx"), `export default function PriceTag(){return null;}`);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames-t-"));
    // rows sorted alphabetically, AppCard first — must NOT fail
    await installBundledComponents(compDir, [
      { name: "AppCard", description: "", origin: "imported", createdAt: "t" },
      { name: "PriceTag", description: "", origin: "imported", createdAt: "t" },
    ], framesRoot);
    expect(await componentExists("AppCard")).toBe(true);
    expect(await componentExists("PriceTag")).toBe(true);
  });

  it("renames on same-name-different-content via SPECIFIER ONLY; labels/comments untouched", async () => {
    await writeComponentRaw({ name: "Button", description: "mine", tsx: `export default function Button(){return <div>MINE</div>;}`, origin: "saved", createdAt: "t" });
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp2-"));
    fs.writeFileSync(path.join(compDir, "Button.tsx"), `export default function Button(){return <div>THEIRS</div>;}`);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames2-"));
    fs.mkdirSync(path.join(framesRoot, "01-home"), { recursive: true });
    fs.writeFileSync(path.join(framesRoot, "01-home", "index.tsx"),
      `import { Button } from "arcade-user/Button";\n// The Button below is primary\nexport default function F(){return <Button aria-label="Button">Button</Button>;}`);

    await installBundledComponents(compDir, [{ name: "Button", description: "d", origin: "imported", createdAt: "t" }], framesRoot);

    expect(await componentExists("ButtonImported")).toBe(true);
    const frame = fs.readFileSync(path.join(framesRoot, "01-home", "index.tsx"), "utf-8");
    // specifier rewritten:
    expect(frame).toContain(`from "arcade-user/ButtonImported"`);
    // binding + JSX + comment + label text UNCHANGED (no corruption):
    expect(frame).toContain(`import { Button }`);
    expect(frame).toContain(`<Button aria-label="Button">Button</Button>`);
    expect(frame).toContain(`// The Button below is primary`);
  });

  it("renamed component exports both old and new names via re-export alias (Bug I2)", async () => {
    await writeComponentRaw({ name: "Button", description: "mine", tsx: `export default function Button(){return <div>MINE</div>;}`, origin: "saved", createdAt: "t" });
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp-alias-"));
    fs.writeFileSync(path.join(compDir, "Button.tsx"), `export default function Button(){return <div>THEIRS</div>;}`);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames-alias-"));

    await installBundledComponents(compDir, [{ name: "Button", description: "d", origin: "imported", createdAt: "t" }], framesRoot);

    const renamedFile = path.join(root, "user-kit", "composites", "ButtonImported.tsx");
    expect(fs.existsSync(renamedFile)).toBe(true);
    const content = fs.readFileSync(renamedFile, "utf-8");
    // Must contain the re-export alias so generator can import { ButtonImported }
    expect(content).toContain("export { Button as ButtonImported }");
  });

  it("skips identical same-name components", async () => {
    const tsx = `export default function Same(){return null;}`;
    await writeComponentRaw({ name: "Same", description: "d", tsx, origin: "saved", createdAt: "t" });
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp3-"));
    fs.writeFileSync(path.join(compDir, "Same.tsx"), tsx);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames3-"));
    await installBundledComponents(compDir, [{ name: "Same", description: "d", origin: "imported", createdAt: "t" }], framesRoot);
    expect(await componentExists("Same")).toBe(true);
  });

  it("uniqueComponentName truncates long bases to stay <=40 chars", async () => {
    const long = "A".repeat(38);
    const out = await uniqueComponentName(long, new Set());
    expect(out.length).toBeLessThanOrEqual(40);
    expect(/^[A-Z][A-Za-z0-9]{1,39}$/.test(out)).toBe(true);
  });

  it("rewriteSpecifier does not touch arcade-user/FooBar when renaming Foo", () => {
    const src = `import { Foo } from "arcade-user/Foo";\nimport { FooBar } from "arcade-user/FooBar";`;
    const out = rewriteSpecifier(src, "Foo", "FooImported");
    expect(out).toContain(`"arcade-user/FooImported"`);
    expect(out).toContain(`"arcade-user/FooBar"`);
  });
});

describe("import safety", () => {
  it("assertNoLinks rejects a symlink entry", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "links-"));
    fs.writeFileSync(path.join(dir, "real.txt"), "ok");
    fs.symlinkSync("/etc/hosts", path.join(dir, "escape"));
    await expect(assertNoLinks(dir)).rejects.toThrow(/link/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("assertNoLinks passes a clean tree", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-"));
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "a.txt"), "hi");
    await expect(assertNoLinks(dir)).resolves.toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("probeBundle sums entries + uncompressed bytes without extracting", async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "probe-src-"));
    fs.writeFileSync(path.join(src, "a.txt"), "x".repeat(1000));
    fs.writeFileSync(path.join(src, "b.txt"), "y".repeat(2000));
    const arc = path.join(src, "p.arcade");
    execFileSync("/usr/bin/tar", ["czf", arc, "-C", src, "a.txt", "b.txt"]);
    const { entries, bytes } = await probeBundle(arc);
    expect(entries).toBeGreaterThanOrEqual(2);
    expect(bytes).toBeGreaterThanOrEqual(3000);
    fs.rmSync(src, { recursive: true, force: true });
  });

  it("extractBundle unpacks a real packed bundle", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-home3-"));
    const proj = await createProject({ name: "Extract Me", theme: "arcade", mode: "light" });
    const { filePath } = await packProject(proj.slug);
    const bytes = fs.readFileSync(filePath);
    const outDir = await extractBundle(bytes);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "project", "project.json"))).toBe(true);
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});

import { unpackAndInstall } from "../../server/projectBundle";
import { listProjects } from "../../server/projects";

describe("unpackAndInstall (round-trip)", () => {
  it("imports a packed bundle into a clean root with recipient paths + seed frame", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "home-a-"));
    const proj = await createProject({ name: "Trip", theme: "devrev-app", mode: "dark" });
    const pdir = path.join(root, "projects", proj.slug);
    fs.mkdirSync(path.join(pdir, "frames", "01-home"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "frames", "01-home", "index.tsx"), `export default function F(){return null;}`);
    fs.writeFileSync(path.join(pdir, "chat-history.json"), `[{"x":1}]`);
    const { filePath } = await packProject(proj.slug);
    const bytes = fs.readFileSync(filePath);

    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-b-"));
    process.env.ARCADE_STUDIO_ROOT = rootB;
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "home-b-"));

    const imported = await unpackAndInstall(bytes);
    expect(imported.theme).toBe("devrev-app");
    expect(imported.mode).toBe("dark");
    const idir = path.join(rootB, "projects", imported.slug);
    expect(fs.existsSync(path.join(idir, "project.json"))).toBe(true);        // folder===slug
    expect(fs.existsSync(path.join(idir, "chat-history.json"))).toBe(false);  // excluded
    expect(fs.existsSync(path.join(idir, "CLAUDE.md"))).toBe(true);           // regenerated
    expect(fs.existsSync(path.join(idir, "frames", "01-home", "index.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(idir, "frames", "00-computer-reference", "index.tsx"))).toBe(true); // seed recreated

    expect((await listProjects()).some((p) => p.slug === imported.slug)).toBe(true);

    fs.rmSync(rootB, { recursive: true, force: true });
  });

  it("re-slugs and marks name on collision", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "home-c-"));
    const proj = await createProject({ name: "Dup", theme: "arcade", mode: "light" });
    const { filePath } = await packProject(proj.slug);
    const bytes = fs.readFileSync(filePath);
    const imported = await unpackAndInstall(bytes); // same root — collides
    expect(imported.slug).not.toBe(proj.slug);
    expect(imported.name).toMatch(/\(imported\)/);
  });

  it("rejects a bundle with a bad format", async () => {
    const bogus = fs.mkdtempSync(path.join(os.tmpdir(), "bogus-"));
    fs.writeFileSync(path.join(bogus, "manifest.json"), JSON.stringify({ format: 99 }));
    fs.mkdirSync(path.join(bogus, "project"));
    fs.writeFileSync(path.join(bogus, "project", "project.json"), "{}");
    fs.mkdirSync(path.join(bogus, "components"));
    execFileSync("/usr/bin/tar", ["czf", path.join(bogus, "b.arcade"), "-C", bogus, "manifest.json", "project", "components"]);
    const bytes = fs.readFileSync(path.join(bogus, "b.arcade"));
    await expect(unpackAndInstall(bytes)).rejects.toThrow(/newer version|format/i);
    fs.rmSync(bogus, { recursive: true, force: true });
  });
});
