import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, listProjects, getProject, renameProject, deleteProject, reconcileFrames, refreshStaleClaudeMd } from "../../server/projects";

let tmp: string;
let fakeHome: string;
let origHome: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  // Redirect ~/.claude/projects to a tmp HOME so rename tests can inspect
  // Claude session dir moves without touching the real Claude install.
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-fakehome-"));
  origHome = process.env.HOME;
  process.env.HOME = fakeHome;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

function claudeDirFor(cwd: string): string {
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, "-");
  return path.join(fakeHome, ".claude", "projects", encoded);
}

// createProject seeds frames/00-computer-reference/ as a designer-facing
// starter (see scaffoldComputerReferenceFrame in server/projects.ts). Tests
// that exercise reconcile semantics on hand-crafted frame fixtures should
// remove it first so assertions stay focused on the fixtures under test.
function clearSeededFrames(slug: string): void {
  const framesDir = path.join(tmp, "projects", slug, "frames");
  for (const entry of fs.readdirSync(framesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) fs.rmSync(path.join(framesDir, entry.name), { recursive: true, force: true });
  }
}

describe("projects CRUD", () => {
  it("creates a project with scaffolded files", async () => {
    const p = await createProject({ name: "My Project", theme: "arcade", mode: "light" });
    expect(p.slug).toBe("my-project");

    const root = path.join(tmp, "projects", "my-project");
    expect(fs.existsSync(path.join(root, "project.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "CLAUDE.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "theme-overrides.css"))).toBe(true);
    expect(fs.existsSync(path.join(root, "frames"))).toBe(true);
    expect(fs.existsSync(path.join(root, "shared"))).toBe(true);
    expect(fs.existsSync(path.join(root, "chat-history.json"))).toBe(true);
    // The DevRev API guide is scaffolded into shared/ so CLAUDE.md can point
    // at it on demand instead of carrying ~250 lines inline every turn.
    expect(fs.existsSync(path.join(root, "shared", "DEVREV-API.md"))).toBe(true);
  });

  it("lists projects sorted by updatedAt desc", async () => {
    await createProject({ name: "Alpha", theme: "arcade", mode: "light" });
    await new Promise((r) => setTimeout(r, 10));
    await createProject({ name: "Beta", theme: "arcade", mode: "light" });
    const ps = await listProjects();
    expect(ps.map((p) => p.name)).toEqual(["Beta", "Alpha"]);
  });

  it("dedupes slugs", async () => {
    const a = await createProject({ name: "Same", theme: "arcade", mode: "light" });
    const b = await createProject({ name: "Same", theme: "arcade", mode: "light" });
    expect(a.slug).toBe("same");
    expect(b.slug).toBe("same-2");
  });

  it("renames a project, moves the dir, and tracks the new slug", async () => {
    const p = await createProject({ name: "Orig", theme: "arcade", mode: "light" });
    await new Promise((r) => setTimeout(r, 10));
    const r = await renameProject(p.slug, "Renamed");
    expect(r.name).toBe("Renamed");
    expect(r.slug).toBe("renamed");
    expect(r.updatedAt > p.updatedAt).toBe(true);

    // Old dir is gone, new dir has the scaffolded files + updated JSON.
    expect(fs.existsSync(path.join(tmp, "projects", p.slug))).toBe(false);
    const newDir = path.join(tmp, "projects", "renamed");
    expect(fs.existsSync(path.join(newDir, "project.json"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "CLAUDE.md"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "frames"))).toBe(true);

    // getProject resolves under the new slug, the old one 404s.
    expect(await getProject(p.slug)).toBeNull();
    const reloaded = await getProject("renamed");
    expect(reloaded?.name).toBe("Renamed");
    expect(reloaded?.slug).toBe("renamed");
  });

  it("keeps the slug when the reslug would match the current one", async () => {
    const p = await createProject({ name: "Orig", theme: "arcade", mode: "light" });
    const r = await renameProject(p.slug, "Orig"); // same slug after slugify
    expect(r.slug).toBe(p.slug);
  });

  it("moves Claude's session dir alongside the project rename", async () => {
    const p = await createProject({ name: "Before", theme: "arcade", mode: "light" });

    // Simulate Claude having written a session.jsonl for this project.
    const oldClaudeDir = claudeDirFor(path.join(tmp, "projects", p.slug));
    fs.mkdirSync(oldClaudeDir, { recursive: true });
    fs.writeFileSync(path.join(oldClaudeDir, "sess-1.jsonl"), "{}\n");

    const r = await renameProject(p.slug, "After");
    expect(r.slug).toBe("after");

    // Old Claude dir is gone. New Claude dir exists with the session file
    // intact — resume from the session still works.
    expect(fs.existsSync(oldClaudeDir)).toBe(false);
    const newClaudeDir = claudeDirFor(path.join(tmp, "projects", "after"));
    expect(fs.existsSync(newClaudeDir)).toBe(true);
    expect(fs.existsSync(path.join(newClaudeDir, "sess-1.jsonl"))).toBe(true);
  });

  it("rename without prior Claude session dir is a silent no-op", async () => {
    // No session.jsonl written — fresh project, user renames before first turn.
    const p = await createProject({ name: "Fresh", theme: "arcade", mode: "light" });
    const r = await renameProject(p.slug, "Renamed");
    expect(r.slug).toBe("renamed");
    // No crash, no leftover Claude dir created.
    const newClaudeDir = claudeDirFor(path.join(tmp, "projects", "renamed"));
    expect(fs.existsSync(newClaudeDir)).toBe(false);
  });

  it("disambiguates the slug when another project already occupies it", async () => {
    const a = await createProject({ name: "Taken", theme: "arcade", mode: "light" });
    const b = await createProject({ name: "Other", theme: "arcade", mode: "light" });
    const r = await renameProject(b.slug, "Taken");
    expect(r.slug).toBe("taken-2");
    // The original "taken" project is unchanged.
    expect((await getProject(a.slug))?.name).toBe("Taken");
  });

  it("deletes a project", async () => {
    const p = await createProject({ name: "Bye", theme: "arcade", mode: "light" });
    await deleteProject(p.slug);
    expect(await getProject(p.slug)).toBeNull();
  });

  it("fills CLAUDE.md template with project name and theme", async () => {
    const p = await createProject({ name: "Login Flow", theme: "arcade", mode: "light" });
    const claudeMd = fs.readFileSync(path.join(tmp, "projects", p.slug, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("# Login Flow");
    expect(claudeMd).toContain("Current theme: **arcade**");
    expect(claudeMd).not.toContain("{{PROJECT_NAME}}");
    expect(claudeMd).not.toContain("{{THEME}}");
  });

  it("renders names with $-style regex backreferences literally", async () => {
    const name = "Foo $& Bar $1 Baz";
    const p = await createProject({ name, theme: "arcade", mode: "light" });
    const claudeMd = fs.readFileSync(path.join(tmp, "projects", p.slug, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain(`# ${name}`);
  });

  it("listProjects skips malformed project.json files instead of throwing", async () => {
    const good = await createProject({ name: "Good", theme: "arcade", mode: "light" });
    const badDir = path.join(tmp, "projects", "bad-legacy");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, "project.json"), JSON.stringify({ name: "Bad", slug: "bad-legacy" }));
    const ps = await listProjects();
    expect(ps.map((p) => p.slug)).toEqual([good.slug]);
  });
});

describe("reconcileFrames", () => {
  it("returns empty array when frames directory is missing and leaves project unchanged", async () => {
    const p = await createProject({ name: "NoFrames", theme: "arcade", mode: "light" });
    const framesDir = path.join(tmp, "projects", p.slug, "frames");
    fs.rmSync(framesDir, { recursive: true, force: true });
    const before = fs.readFileSync(path.join(tmp, "projects", p.slug, "project.json"), "utf-8");

    const result = await reconcileFrames(p.slug);
    expect(result).toEqual([]);

    const after = fs.readFileSync(path.join(tmp, "projects", p.slug, "project.json"), "utf-8");
    expect(after).toBe(before);
  });

  it("hides the unmodified seeded reference frame from the frame list", async () => {
    const p = await createProject({ name: "Seeded", theme: "arcade", mode: "light" });
    // The seed exists on disk...
    const seedIdx = path.join(tmp, "projects", p.slug, "frames", "00-computer-reference", "index.tsx");
    expect(fs.existsSync(seedIdx)).toBe(true);
    // ...but reconcile must not surface it while it's untouched.
    const result = await reconcileFrames(p.slug);
    expect(result.map((f) => f.slug)).not.toContain("00-computer-reference");
    expect(result).toEqual([]);
  });

  it("surfaces the reference frame once it has been modified", async () => {
    const p = await createProject({ name: "Edited", theme: "arcade", mode: "light" });
    const seedIdx = path.join(tmp, "projects", p.slug, "frames", "00-computer-reference", "index.tsx");
    fs.writeFileSync(seedIdx, `export default () => <div>edited</div>;`);

    const result = await reconcileFrames(p.slug);
    expect(result.map((f) => f.slug)).toContain("00-computer-reference");
  });

  it("adds on-disk frames not listed in project.json", async () => {
    const p = await createProject({ name: "Discover", theme: "arcade", mode: "light" });
    clearSeededFrames(p.slug);
    const framesDir = path.join(tmp, "projects", p.slug, "frames");
    for (const slug of ["welcome-screen", "home-page"]) {
      const d = path.join(framesDir, slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "index.tsx"), `export default () => <div/>;`);
    }

    const result = await reconcileFrames(p.slug);
    expect(result.map((f) => f.slug).sort()).toEqual(["home-page", "welcome-screen"]);
    const welcome = result.find((f) => f.slug === "welcome-screen");
    expect(welcome?.name).toBe("Welcome Screen");
    expect(welcome?.size).toBe("1440");

    const persisted = await getProject(p.slug);
    expect(persisted?.frames.map((f) => f.slug).sort()).toEqual(["home-page", "welcome-screen"]);
  });

  it("does not rewrite project.json when on-disk frames match exactly", async () => {
    const p = await createProject({ name: "Match", theme: "arcade", mode: "light" });
    clearSeededFrames(p.slug);
    const framesDir = path.join(tmp, "projects", p.slug, "frames");
    const frameSlug = "only-frame";
    const frameDir = path.join(framesDir, frameSlug);
    fs.mkdirSync(frameDir, { recursive: true });
    fs.writeFileSync(path.join(frameDir, "index.tsx"), `export default () => <div/>;`);

    // First reconcile to populate project.json with the frame
    await reconcileFrames(p.slug);
    const projectJsonPath = path.join(tmp, "projects", p.slug, "project.json");
    const mtimeBefore = fs.statSync(projectJsonPath).mtimeMs;
    const contentBefore = fs.readFileSync(projectJsonPath, "utf-8");

    await new Promise((r) => setTimeout(r, 20));
    // Second reconcile should be a no-op
    const result = await reconcileFrames(p.slug);
    expect(result.map((f) => f.slug)).toEqual([frameSlug]);

    const mtimeAfter = fs.statSync(projectJsonPath).mtimeMs;
    const contentAfter = fs.readFileSync(projectJsonPath, "utf-8");
    expect(mtimeAfter).toBe(mtimeBefore);
    expect(contentAfter).toBe(contentBefore);
  });

  it("prunes frames when their directories are removed from disk", async () => {
    const p = await createProject({ name: "Prune", theme: "arcade", mode: "light" });
    clearSeededFrames(p.slug);
    const framesDir = path.join(tmp, "projects", p.slug, "frames");
    for (const slug of ["keeper", "doomed"]) {
      const d = path.join(framesDir, slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "index.tsx"), `export default () => <div/>;`);
    }
    await reconcileFrames(p.slug);

    fs.rmSync(path.join(framesDir, "doomed"), { recursive: true, force: true });

    const result = await reconcileFrames(p.slug);
    expect(result.map((f) => f.slug)).toEqual(["keeper"]);
    const persisted = await getProject(p.slug);
    expect(persisted?.frames.map((f) => f.slug)).toEqual(["keeper"]);
  });

  it("deduplicates concurrent calls for the same slug", async () => {
    const p = await createProject({ name: "Race", theme: "arcade", mode: "light" });
    clearSeededFrames(p.slug);
    const framesDir = path.join(tmp, "projects", p.slug, "frames");
    const d = path.join(framesDir, "only");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "index.tsx"), `export default () => <div/>;`);

    const [a, b, c] = await Promise.all([
      reconcileFrames(p.slug),
      reconcileFrames(p.slug),
      reconcileFrames(p.slug),
    ]);
    expect(a.map((f) => f.slug)).toEqual(["only"]);
    expect(b.map((f) => f.slug)).toEqual(["only"]);
    expect(c.map((f) => f.slug)).toEqual(["only"]);
  });
});

describe("project memory seeding", () => {
  it("createProject seeds memory/RULES.md + memory/LEARNED.md", async () => {
    await createProject({ name: "Mem Proj", theme: "arcade", mode: "light" });
    const memDir = path.join(tmp, "projects", "mem-proj", "memory");
    expect(fs.existsSync(path.join(memDir, "RULES.md"))).toBe(true);
    expect(fs.existsSync(path.join(memDir, "LEARNED.md"))).toBe(true);
  });

  it("refreshStaleClaudeMd backfills memory/ for a project lacking it", async () => {
    await createProject({ name: "Old Proj", theme: "arcade", mode: "light" });
    // Simulate a pre-feature project: delete its memory dir.
    const memDir = path.join(tmp, "projects", "old-proj", "memory");
    fs.rmSync(memDir, { recursive: true, force: true });
    expect(fs.existsSync(memDir)).toBe(false);

    await refreshStaleClaudeMd();
    expect(fs.existsSync(path.join(memDir, "RULES.md"))).toBe(true);
    expect(fs.existsSync(path.join(memDir, "LEARNED.md"))).toBe(true);
  });
});

describe("CLAUDE.md memory imports", () => {
  it("renders the four memory @import lines with a resolved global path", async () => {
    await createProject({ name: "Mem Imports", theme: "arcade", mode: "light" });
    const md = fs.readFileSync(
      path.join(tmp, "projects", "mem-imports", "CLAUDE.md"),
      "utf-8",
    );
    // Project-relative imports
    expect(md).toContain("@memory/RULES.md");
    expect(md).toContain("@memory/LEARNED.md");
    // Global imports resolved to an absolute path under the tmp studio root
    expect(md).toContain(`@${path.join(tmp, "memory", "RULES.md")}`);
    expect(md).toContain(`@${path.join(tmp, "memory", "LEARNED.md")}`);
    // No unreplaced placeholder
    expect(md).not.toContain("{{GLOBAL_MEMORY}}");
  });
});

describe("refreshStaleClaudeMd backup behavior", () => {
  it("writes .bak with the prior contents before overwriting a stale CLAUDE.md", async () => {
    const p = await createProject({ name: "Backup", theme: "arcade", mode: "light" });
    const file = path.join(tmp, "projects", p.slug, "CLAUDE.md");
    const bakFile = `${file}.bak`;
    const userEdit = "# USER EDITS — HANDS OFF\n\nDo not overwrite this!\n";
    fs.writeFileSync(file, userEdit);

    const refreshed = await refreshStaleClaudeMd();

    expect(refreshed).toBe(1);
    expect(fs.existsSync(bakFile)).toBe(true);
    expect(fs.readFileSync(bakFile, "utf-8")).toBe(userEdit);
    const currentRendered = fs.readFileSync(file, "utf-8");
    expect(currentRendered).not.toBe(userEdit);
    expect(currentRendered).toContain("## Design system");
  });

  it("does not create .bak when CLAUDE.md is absent entirely", async () => {
    const p = await createProject({ name: "Fresh", theme: "arcade", mode: "light" });
    const file = path.join(tmp, "projects", p.slug, "CLAUDE.md");
    const bakFile = `${file}.bak`;
    fs.rmSync(file);

    await refreshStaleClaudeMd();

    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(bakFile)).toBe(false);
  });

  it("does not touch CLAUDE.md when it already matches the template", async () => {
    const p = await createProject({ name: "Current", theme: "arcade", mode: "light" });
    const file = path.join(tmp, "projects", p.slug, "CLAUDE.md");
    const bakFile = `${file}.bak`;

    const refreshed = await refreshStaleClaudeMd();

    expect(refreshed).toBe(0);
    expect(fs.existsSync(bakFile)).toBe(false);
  });
});
