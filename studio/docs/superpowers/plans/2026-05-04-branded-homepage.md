# Branded Homepage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Studio's current projects-list homepage with a branded hero prompt input (progressive font-shrink, model selector, attachments parity with the chat input except target chips) that creates a project on submit and hands the first turn off to the per-project chat pane. The existing project gallery stays below the hero as a compact 3-column grid.

**Architecture:** A new `HomePage` route composes a `HeroPromptInput` (borderless, 50px → 20px font scaling via `scrollHeight` measurement) and a compact `ProjectsSection` (pure presentation over existing `ProjectCard`). Submit flow: stage image uploads under a session-scoped folder, create project via existing API, `POST /api/projects/:slug/adopt-uploads` to move staged files into the project, stash the prompt in a `PendingPromptContext`, and navigate. `ChatPane` reads the pending prompt on mount and fires the first turn.

**Tech Stack:** React + TypeScript, existing Vite middleware pattern, `@xorkavi/arcade-gen` for Select/IconButton/etc., vitest + jsdom for tests. No new dependencies.

---

## File Structure

**Create:**
- `studio/src/lib/deriveProjectName.ts` — pure string helper, name from prompt.
- `studio/src/lib/nextFontSize.ts` — pure font-scaling helper used by the hero input.
- `studio/src/hooks/pendingPromptContext.tsx` — one-shot prompt carrier between home and ChatPane.
- `studio/src/components/home/HeroPromptInput.tsx` — the giant borderless input.
- `studio/src/components/home/ProjectsSection.tsx` — compact gallery.
- `studio/src/components/home/HeroModelSelector.tsx` — pill model switcher in the trailing row.
- `studio/src/routes/HomePage.tsx` — the new homepage route (replaces `ProjectList.tsx`).
- `studio/server/middleware/stagingUploads.ts` — `POST /api/uploads/_staging`, staging-folder cleanup helper.
- `studio/server/middleware/adoptUploads.ts` — `POST /api/projects/:slug/adopt-uploads`.
- `studio/__tests__/lib/deriveProjectName.test.ts`
- `studio/__tests__/lib/nextFontSize.test.ts`
- `studio/__tests__/hooks/pendingPromptContext.test.tsx`
- `studio/__tests__/components/home/hero-prompt-input.test.tsx`
- `studio/__tests__/components/home/projects-section.test.tsx`
- `studio/__tests__/server/middleware/stagingUploads.test.ts`
- `studio/__tests__/server/middleware/adoptUploads.test.ts`

**Modify:**
- `studio/src/lib/api.ts` — add `stageUpload`, `adoptUploads` client helpers.
- `studio/src/components/chat/ChatPane.tsx` — consume a pending first-turn prompt on mount.
- `studio/src/App.tsx` — mount `<PendingPromptProvider>`; swap `ProjectList` for `HomePage`.
- `studio/vite.config.ts` — register the two new middlewares.
- `studio/server/paths.ts` — add `stagingRoot()` + `stagingSessionDir(sessionId)` helpers.
- `studio/packaging/VERSION` — bump to `0.7.0`.
- `studio/CHANGELOG.md` — add `[0.7.0]` entry.

**Delete:**
- `studio/src/routes/ProjectList.tsx` — replaced by `HomePage.tsx`.

---

## Task 1: `deriveProjectName` helper

A tiny pure function the hero submit flow uses to derive a project name from the user's prompt. Extracting it keeps the route thin and gives us a trivial test harness.

**Files:**
- Create: `studio/src/lib/deriveProjectName.ts`
- Create: `studio/__tests__/lib/deriveProjectName.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/lib/deriveProjectName.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveProjectName } from "../../src/lib/deriveProjectName";

describe("deriveProjectName", () => {
  it("returns 'Untitled project' for empty input", () => {
    expect(deriveProjectName("")).toBe("Untitled project");
    expect(deriveProjectName("   ")).toBe("Untitled project");
  });

  it("returns the trimmed prompt when short enough", () => {
    expect(deriveProjectName("  a landing page  ")).toBe("a landing page");
  });

  it("truncates at the last word boundary within 40 chars", () => {
    const input = "a landing page for a specialty coffee roasting shop";
    const out = deriveProjectName(input);
    expect(out).toBe("a landing page for a specialty coffee…");
    expect(out.length).toBeLessThanOrEqual(40 + 1); // +1 for ellipsis
  });

  it("hard-cuts when the first 40 chars contain no whitespace", () => {
    const input = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 43 a's
    const out = deriveProjectName(input);
    expect(out).toBe("a".repeat(40) + "…");
  });
});
```

- [ ] **Step 2: Run to confirm the test fails**

Run: `pnpm run studio:test __tests__/lib/deriveProjectName.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `studio/src/lib/deriveProjectName.ts`:

```ts
const MAX_LENGTH = 40;

export function deriveProjectName(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Untitled project";
  if (trimmed.length <= MAX_LENGTH) return trimmed;

  const slice = trimmed.slice(0, MAX_LENGTH);
  const lastBreak = slice.lastIndexOf(" ");
  if (lastBreak > 0) return slice.slice(0, lastBreak).trim() + "…";
  return slice + "…";
}
```

- [ ] **Step 4: Re-run the test to confirm it passes**

Run: `pnpm run studio:test __tests__/lib/deriveProjectName.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/deriveProjectName.ts studio/__tests__/lib/deriveProjectName.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/home): add deriveProjectName helper

Used by the new hero prompt input to name projects from the first line
of the user's prompt.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `nextFontSize` helper (progressive shrink)

Pure function that decides the next font-size for the hero textarea given its last-measured `scrollHeight`. Extracting it from React means we can test the curve deterministically without wrestling with jsdom's zero-sized layout.

**Files:**
- Create: `studio/src/lib/nextFontSize.ts`
- Create: `studio/__tests__/lib/nextFontSize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/lib/nextFontSize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextFontSize } from "../../src/lib/nextFontSize";

describe("nextFontSize", () => {
  const base = { start: 50, floor: 20, step: 2, maxHeight: 180 };

  it("returns current size when content fits", () => {
    expect(nextFontSize({ ...base, current: 50, measuredHeight: 60 })).toBe(50);
  });

  it("shrinks by one step when content overflows", () => {
    expect(nextFontSize({ ...base, current: 50, measuredHeight: 200 })).toBe(48);
  });

  it("never goes below the floor", () => {
    expect(nextFontSize({ ...base, current: 20, measuredHeight: 900 })).toBe(20);
  });

  it("grows back toward start when there is slack and we are below start", () => {
    expect(nextFontSize({ ...base, current: 30, measuredHeight: 60 })).toBe(32);
  });

  it("does not grow past start", () => {
    expect(nextFontSize({ ...base, current: 50, measuredHeight: 10 })).toBe(50);
  });

  it("shrinks when measured height exceeds max", () => {
    expect(nextFontSize({ ...base, current: 30, measuredHeight: 181 })).toBe(28);
  });

  it("returns current when measured height exactly equals max", () => {
    expect(nextFontSize({ ...base, current: 30, measuredHeight: 180 })).toBe(30);
  });
});
```

- [ ] **Step 2: Run to confirm the test fails**

Run: `pnpm run studio:test __tests__/lib/nextFontSize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `studio/src/lib/nextFontSize.ts`:

```ts
export interface NextFontSizeArgs {
  /** Current rendered font-size in px. */
  current: number;
  /** Max (starting) font-size in px. The input never grows past this. */
  start: number;
  /** Floor font-size in px. Below this we scroll instead of shrinking. */
  floor: number;
  /** Step size in px for each shrink/grow iteration. */
  step: number;
  /** Last-measured textarea scrollHeight in px. */
  measuredHeight: number;
  /** Target max height the textarea should fit within. */
  maxHeight: number;
}

/**
 * Pure font-size stepper used by HeroPromptInput. Returns the next font-size
 * to render based on whether the textarea is overflowing or has slack.
 *
 * The React caller runs this inside useLayoutEffect after every text change:
 * set the size, re-measure on the next render, call again. One-step-at-a-time
 * keeps each iteration legible and animatable.
 */
export function nextFontSize({
  current,
  start,
  floor,
  step,
  measuredHeight,
  maxHeight,
}: NextFontSizeArgs): number {
  if (measuredHeight > maxHeight && current > floor) {
    return Math.max(floor, current - step);
  }
  if (current < start) {
    // Predict scrollHeight at the next larger size assuming near-linear
    // scaling. Only grow if the prediction still fits, so we don't
    // oscillate between two adjacent sizes.
    const predicted = measuredHeight * ((current + step) / current);
    if (predicted <= maxHeight) {
      return Math.min(start, current + step);
    }
  }
  return current;
}
```

- [ ] **Step 4: Re-run the test**

Run: `pnpm run studio:test __tests__/lib/nextFontSize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/nextFontSize.ts studio/__tests__/lib/nextFontSize.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/home): add nextFontSize stepper helper

Pure function that decides the hero input's next rendered font-size given
the textarea's last-measured scrollHeight. Keeping this out of the
component lets us test the shrink curve deterministically.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Staging-uploads paths + server middleware

Adds `POST /api/uploads/_staging` so the hero input can accept image uploads before a project exists. Files land in `<studioRoot>/uploads-staging/<sessionId>/`; the session id is taken from a cookie.

**Files:**
- Modify: `studio/server/paths.ts` (append two helpers)
- Create: `studio/server/middleware/stagingUploads.ts`
- Create: `studio/__tests__/server/middleware/stagingUploads.test.ts`

- [ ] **Step 1: Add path helpers**

Append to `studio/server/paths.ts`:

```ts
/**
 * Root folder for pre-project uploads (images pasted into the hero input
 * before a project exists). Sibling of `projects/`; `adopt-uploads` moves
 * files from here into the project once it is created.
 */
export function stagingRoot(): string {
  return path.join(studioRoot(), "uploads-staging");
}

const SESSION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function requireSessionId(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error(`Invalid staging session id: ${id}`);
  return id;
}

export function stagingSessionDir(sessionId: string): string {
  return path.join(stagingRoot(), requireSessionId(sessionId));
}
```

- [ ] **Step 2: Write the failing middleware test**

Create `studio/__tests__/server/middleware/stagingUploads.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { stagingUploadsMiddleware } from "../../../server/middleware/stagingUploads";

let server: http.Server;
let port: number;
let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-staging-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  server = http.createServer(stagingUploadsMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ARCADE_STUDIO_ROOT;
});

async function post(pathname: string, body: Buffer, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any; sessionCookie?: string }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "POST", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const setCookie = res.headers["set-cookie"]?.[0];
          const sessionCookie = setCookie
            ? /studio_staging_session=([^;]+)/.exec(setCookie)?.[1]
            : undefined;
          try {
            resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null, sessionCookie });
          } catch (e) { reject(e); }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

describe("POST /api/uploads/_staging", () => {
  it("writes the image and returns a path under the staging root", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // fake PNG header
    const res = await post("/api/uploads/_staging", png, { "content-type": "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(/uploads-staging\/.+\.png$/);
    expect(fs.existsSync(res.body.path)).toBe(true);
    expect(res.sessionCookie).toBeTruthy();
  });

  it("reuses the session from the request cookie when present", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const first = await post("/api/uploads/_staging", png, { "content-type": "image/png" });
    const second = await post("/api/uploads/_staging", png, {
      "content-type": "image/png",
      cookie: `studio_staging_session=${first.sessionCookie}`,
    });
    expect(second.status).toBe(200);
    expect(path.dirname(first.body.path)).toBe(path.dirname(second.body.path));
  });

  it("rejects unsupported mime types", async () => {
    const res = await post("/api/uploads/_staging", Buffer.from("nope"), {
      "content-type": "text/plain",
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm run studio:test __tests__/server/middleware/stagingUploads.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the middleware**

Create `studio/server/middleware/stagingUploads.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { stagingRoot, stagingSessionDir } from "../paths";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const COOKIE_NAME = "studio_staging_session";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("=")) || null;
  }
  return null;
}

function newSessionId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function stagingUploadsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.url !== "/api/uploads/_staging" || req.method !== "POST") return next?.();

    const ct = req.headers["content-type"] ?? "";
    const extMatch = /image\/(png|jpeg|webp|gif)/.exec(ct);
    if (!extMatch) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Unsupported image type" } }));
      return;
    }

    const existing = parseCookie(req.headers.cookie, COOKIE_NAME);
    const sessionId = existing ?? newSessionId();

    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    try {
      for await (const c of req) {
        total += c.length;
        if (total > MAX_UPLOAD_BYTES) { tooLarge = true; break; }
        chunks.push(Buffer.from(c));
      }
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err?.message ?? "upload failed" } }));
      return;
    }

    if (tooLarge) {
      req.on("error", () => {});
      req.resume();
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Image too large (max 10MB)" } }));
      return;
    }

    try {
      const dir = stagingSessionDir(sessionId);
      await fs.mkdir(dir, { recursive: true });
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extMatch[1]}`;
      const abs = path.join(dir, name);
      await fs.writeFile(abs, Buffer.concat(chunks));
      const headers: Record<string, string | string[]> = { "Content-Type": "application/json" };
      if (!existing) {
        headers["Set-Cookie"] =
          `${COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly`;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ path: abs, url: `/@fs${abs}` }));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err?.message ?? "upload failed" } }));
    }
  };
}

/** Delete any staging session folders older than `maxAgeMs`. Silent on error. */
export async function cleanStaleStagingSessions(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  try {
    const root = stagingRoot();
    const entries = await fs.readdir(root, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeMs;
    await Promise.all(entries.map(async (e) => {
      if (!e.isDirectory()) return;
      const abs = path.join(root, e.name);
      const stat = await fs.stat(abs).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) {
        await fs.rm(abs, { recursive: true, force: true }).catch(() => {});
      }
    }));
  } catch {
    // root may not exist yet — that's fine
  }
}
```

- [ ] **Step 5: Re-run the test**

Run: `pnpm run studio:test __tests__/server/middleware/stagingUploads.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the middleware + cleanup in Vite config**

In `studio/vite.config.ts`, add the import at the top of the import block:

```ts
import { stagingUploadsMiddleware, cleanStaleStagingSessions } from "./server/middleware/stagingUploads";
```

And inside `apiPlugin()`'s `configureServer`, register it right after the existing `uploadsMiddleware()` line and trigger cleanup alongside `logVersionOnBoot()`:

```ts
      server.middlewares.use(uploadsMiddleware());
      server.middlewares.use(stagingUploadsMiddleware());
      // …
      void logVersionOnBoot();
      void cleanStaleStagingSessions();
```

- [ ] **Step 7: Commit**

```bash
git add studio/server/paths.ts studio/server/middleware/stagingUploads.ts \
        studio/vite.config.ts \
        studio/__tests__/server/middleware/stagingUploads.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/uploads): add staging uploads endpoint

POST /api/uploads/_staging accepts images before a project exists and
writes them under a cookie-scoped session folder. Hero prompt input
uses this; adopt-uploads (next task) moves files into the project on
create.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Adopt-uploads endpoint

`POST /api/projects/:slug/adopt-uploads` moves files from a staging session into the real project's `_uploads/` folder and returns `{ mapping, missing }`. The hero submit flow calls this after `createProject` so image paths in the chat turn point at project-scoped files, not staging.

**Files:**
- Create: `studio/server/middleware/adoptUploads.ts`
- Create: `studio/__tests__/server/middleware/adoptUploads.test.ts`
- Modify: `studio/vite.config.ts` (register the middleware)

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/middleware/adoptUploads.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { adoptUploadsMiddleware } from "../../../server/middleware/adoptUploads";
import { createProject } from "../../../server/projects";
import { stagingSessionDir } from "../../../server/paths";

let server: http.Server;
let port: number;
let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-adopt-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  server = http.createServer(adoptUploadsMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ARCADE_STUDIO_ROOT;
});

async function post(pathname: string, body: any, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(buf.length), ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
        });
      },
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

describe("POST /api/projects/:slug/adopt-uploads", () => {
  it("moves files from staging into the project and reports mapping", async () => {
    const project = await createProject({ name: "Test", theme: "arcade", mode: "light" });
    const sessionDir = stagingSessionDir("alice");
    fs.mkdirSync(sessionDir, { recursive: true });
    const stagedPath = path.join(sessionDir, "photo.png");
    fs.writeFileSync(stagedPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const res = await post(`/api/projects/${project.slug}/adopt-uploads`, {
      paths: [stagedPath],
    });

    expect(res.status).toBe(200);
    expect(res.body.missing).toEqual([]);
    expect(res.body.mapping[stagedPath]).toMatch(new RegExp(`/projects/${project.slug}/_uploads/photo\\.png$`));
    expect(fs.existsSync(stagedPath)).toBe(false);
    expect(fs.existsSync(res.body.mapping[stagedPath])).toBe(true);
  });

  it("reports missing paths instead of throwing", async () => {
    const project = await createProject({ name: "Test", theme: "arcade", mode: "light" });
    const ghost = path.join(tmp, "uploads-staging/nope/ghost.png");
    const res = await post(`/api/projects/${project.slug}/adopt-uploads`, { paths: [ghost] });
    expect(res.status).toBe(200);
    expect(res.body.missing).toEqual([ghost]);
    expect(res.body.mapping).toEqual({});
  });

  it("rejects paths outside the staging root", async () => {
    const project = await createProject({ name: "Test", theme: "arcade", mode: "light" });
    const escape = path.join(tmp, "../outside.png");
    const res = await post(`/api/projects/${project.slug}/adopt-uploads`, { paths: [escape] });
    expect(res.status).toBe(200);
    expect(res.body.missing).toEqual([escape]);
  });

  it("404s when the project does not exist", async () => {
    const res = await post(`/api/projects/nonexistent/adopt-uploads`, { paths: [] });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to confirm the test fails**

Run: `pnpm run studio:test __tests__/server/middleware/adoptUploads.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the middleware**

Create `studio/server/middleware/adoptUploads.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { projectDir, stagingRoot } from "../paths";
import { getProject } from "../projects";

const ROUTE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/adopt-uploads$/i;

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  return buf ? JSON.parse(buf) : {};
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/**
 * Moves a staged upload into the project's _uploads/ folder.
 * Returns the destination path on success, or null if the source is missing
 * or escapes the staging root.
 */
async function adoptOne(srcAbs: string, projectSlug: string): Promise<string | null> {
  const root = stagingRoot();
  const normalized = path.resolve(srcAbs);
  if (!normalized.startsWith(root + path.sep)) return null;

  try {
    await fs.access(normalized);
  } catch {
    return null;
  }

  const destDir = path.join(projectDir(projectSlug), "_uploads");
  await fs.mkdir(destDir, { recursive: true });

  const base = path.basename(normalized);
  let destName = base;
  let counter = 1;
  while (true) {
    const candidate = path.join(destDir, destName);
    try {
      await fs.access(candidate);
      const ext = path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      destName = `${stem}-${counter}${ext}`;
      counter += 1;
    } catch {
      break;
    }
  }
  const destAbs = path.join(destDir, destName);

  try {
    await fs.rename(normalized, destAbs);
  } catch (err: any) {
    if (err?.code === "EXDEV") {
      await fs.copyFile(normalized, destAbs);
      await fs.unlink(normalized).catch(() => {});
    } else {
      throw err;
    }
  }
  return destAbs;
}

export function adoptUploadsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const m = req.url?.match(ROUTE);
    if (!m || req.method !== "POST") return next?.();
    const slug = m[1];

    const project = await getProject(slug);
    if (!project) return send(res, 404, { error: { message: "Project not found" } });

    let body: any;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: { message: "Invalid JSON" } }); }

    const paths: unknown = body?.paths;
    if (!Array.isArray(paths)) return send(res, 400, { error: { message: "paths must be an array" } });

    const mapping: Record<string, string> = {};
    const missing: string[] = [];

    for (const p of paths) {
      if (typeof p !== "string") { missing.push(String(p)); continue; }
      try {
        const dest = await adoptOne(p, slug);
        if (dest) mapping[p] = dest;
        else missing.push(p);
      } catch {
        missing.push(p);
      }
    }

    return send(res, 200, { mapping, missing });
  };
}
```

- [ ] **Step 4: Re-run the test**

Run: `pnpm run studio:test __tests__/server/middleware/adoptUploads.test.ts`
Expected: PASS.

- [ ] **Step 5: Register in Vite config**

In `studio/vite.config.ts`, add to the import block:

```ts
import { adoptUploadsMiddleware } from "./server/middleware/adoptUploads";
```

And inside `configureServer`, register it after `projectsMiddleware()`:

```ts
      server.middlewares.use(projectsMiddleware());
      server.middlewares.use(adoptUploadsMiddleware());
```

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/adoptUploads.ts \
        studio/vite.config.ts \
        studio/__tests__/server/middleware/adoptUploads.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/uploads): adopt staged uploads into new projects

POST /api/projects/:slug/adopt-uploads moves files from the staging
folder into the project's _uploads/ directory and returns a mapping so
the client can remap image paths for the first chat turn.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Client API helpers (`stageUpload`, `adoptUploads`)

Adds two small client methods so the route component doesn't reach for `fetch` directly.

**Files:**
- Modify: `studio/src/lib/api.ts`

- [ ] **Step 1: Extend `api.ts`**

Replace the content of `studio/src/lib/api.ts` with:

```ts
import type { Project } from "../../server/types";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg: string;
    try { msg = (await res.json()).error?.message ?? `HTTP ${res.status}`; }
    catch { msg = `HTTP ${res.status}`; }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : (await res.json()) as T;
}

export const api = {
  listProjects: () => fetch("/api/projects").then(j<Project[]>),
  createProject: (input: { name: string; theme: "arcade" | "devrev-app"; mode: "light" | "dark" }) =>
    fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then(j<Project>),
  renameProject: (slug: string, name: string) =>
    fetch(`/api/projects/${slug}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(j<Project>),
  deleteProject: (slug: string) =>
    fetch(`/api/projects/${slug}`, { method: "DELETE" }).then(j<void>),
  stageUpload: (blob: Blob) =>
    fetch("/api/uploads/_staging", {
      method: "POST",
      headers: { "Content-Type": blob.type },
      credentials: "include",
      body: blob,
    }).then(j<{ path: string; url: string }>),
  adoptUploads: (slug: string, paths: string[]) =>
    fetch(`/api/projects/${slug}/adopt-uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    }).then(j<{ mapping: Record<string, string>; missing: string[] }>),
};
```

- [ ] **Step 2: Verify the existing suite still type-checks / passes**

Run: `pnpm run studio:test __tests__/`
Expected: all previously-passing tests still pass (the diff only adds methods — nothing existing changes).

- [ ] **Step 3: Commit**

```bash
git add studio/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(studio/api): add stageUpload and adoptUploads client helpers

Client-side counterparts to the new /api/uploads/_staging and
/api/projects/:slug/adopt-uploads endpoints.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `PendingPromptContext`

A one-shot context that carries the hero's prompt+attachments from `HomePage` to the project's `ChatPane` across the hash-route change in `App.tsx`.

**Files:**
- Create: `studio/src/hooks/pendingPromptContext.tsx`
- Create: `studio/__tests__/hooks/pendingPromptContext.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/hooks/pendingPromptContext.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  PendingPromptProvider,
  usePendingPrompt,
} from "../../src/hooks/pendingPromptContext";

const wrapper = ({ children }: { children: ReactNode }) => (
  <PendingPromptProvider>{children}</PendingPromptProvider>
);

describe("PendingPromptContext", () => {
  it("stores a prompt and consume() returns + clears it", () => {
    const { result } = renderHook(() => usePendingPrompt(), { wrapper });

    act(() => {
      result.current.set({ prompt: "hi", imagePaths: ["/a"], figmaUrl: null });
    });

    const consumed = result.current.consume();
    expect(consumed).toEqual({ prompt: "hi", imagePaths: ["/a"], figmaUrl: null });

    // Second consume returns null — one-shot semantics.
    expect(result.current.consume()).toBeNull();
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => usePendingPrompt())).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm run studio:test __tests__/hooks/pendingPromptContext.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the context**

Create `studio/src/hooks/pendingPromptContext.tsx`:

```tsx
import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

export interface PendingPrompt {
  prompt: string;
  imagePaths: string[];
  figmaUrl: string | null;
}

export interface PendingPromptContextValue {
  set: (p: PendingPrompt) => void;
  consume: () => PendingPrompt | null;
}

const Ctx = createContext<PendingPromptContextValue | null>(null);

export function PendingPromptProvider({ children }: { children: ReactNode }) {
  const boxRef = useRef<PendingPrompt | null>(null);
  const value = useMemo<PendingPromptContextValue>(
    () => ({
      set: (p) => { boxRef.current = p; },
      consume: () => {
        const v = boxRef.current;
        boxRef.current = null;
        return v;
      },
    }),
    [],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePendingPrompt(): PendingPromptContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePendingPrompt must be used inside <PendingPromptProvider>");
  return ctx;
}
```

- [ ] **Step 4: Re-run the test**

Run: `pnpm run studio:test __tests__/hooks/pendingPromptContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/hooks/pendingPromptContext.tsx studio/__tests__/hooks/pendingPromptContext.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/hooks): add PendingPromptContext

One-shot carrier for handing the hero input's prompt + attachments to
ChatPane when HomePage navigates into a new project.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire `ChatPane` to consume the pending prompt on mount

`ChatPane` checks `usePendingPrompt().consume()` on mount. If a prompt is present, it fires exactly one turn via the existing `enhancedSend` path — images and Figma URL come along.

**Files:**
- Modify: `studio/src/components/chat/ChatPane.tsx`

- [ ] **Step 1: Edit `ChatPane.tsx`**

Open `studio/src/components/chat/ChatPane.tsx`. At the top of the imports add:

```ts
import { usePendingPrompt } from "../../hooks/pendingPromptContext";
```

Inside the component, after the existing `const { state, send, retry } = useChatStreamContext();` line, add:

```ts
  const pending = usePendingPrompt();

  useEffect(() => {
    const p = pending.consume();
    if (!p) return;
    const withFigma = p.figmaUrl ? decoratePromptWithFigma(p.prompt, p.figmaUrl) : p.prompt;
    send(withFigma, p.imagePaths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

The dependency array is intentionally empty so `consume()` runs exactly once, on mount. `pending` itself is stable (memoized in the provider).

- [ ] **Step 2: Verify the chat tests still pass**

Run: `pnpm run studio:test __tests__/server/middleware/chat.test.ts`
Expected: PASS (server-side chat tests are unchanged).

Run: `pnpm run studio:test __tests__/`
Expected: whole suite still passes.

- [ ] **Step 3: Commit**

```bash
git add studio/src/components/chat/ChatPane.tsx
git commit -m "$(cat <<'EOF'
feat(studio/chat): fire pending first-turn prompt on mount

ChatPane reads PendingPromptContext on mount and, when a prompt is
present (navigated from the new hero input), sends it as the first
chat turn with any staged image paths and Figma URL decoration.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `HeroModelSelector` component

A small pill-shaped model picker that reads/writes `studio.model` through `/api/settings`. Mirrors the selector in `AppSettingsModal` but renders compactly in the hero's trailing row.

**Files:**
- Create: `studio/src/components/home/HeroModelSelector.tsx`

- [ ] **Step 1: Create the component**

Create `studio/src/components/home/HeroModelSelector.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Select } from "@xorkavi/arcade-gen";

const MODEL_DEFAULT_SENTINEL = "__default__";

const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: MODEL_DEFAULT_SENTINEL, label: "Auto" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

export function HeroModelSelector() {
  const [value, setValue] = useState<string>(MODEL_DEFAULT_SENTINEL);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setValue(data?.studio?.model || MODEL_DEFAULT_SENTINEL);
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const onChange = useCallback(async (next: string) => {
    setValue(next);
    const persisted = next === MODEL_DEFAULT_SENTINEL ? undefined : next;
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio: { model: persisted } }),
      });
    } catch { /* non-critical — UI already updated */ }
  }, []);

  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger id="hero-model-selector" aria-label="Model" />
      <Select.Content>
        {MODEL_OPTIONS.map((opt) => (
          <Select.Item key={opt.value} value={opt.value}>
            {opt.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
```

- [ ] **Step 2: Smoke-check the import path**

Run: `pnpm run studio:test __tests__/components/select-item-empty-value.test.ts`
Expected: PASS — the static scan is the one that fires on any new `Select.Item`, and none of our new items use `value=""`.

- [ ] **Step 3: Commit**

```bash
git add studio/src/components/home/HeroModelSelector.tsx
git commit -m "$(cat <<'EOF'
feat(studio/home): add HeroModelSelector

Compact Select pill for picking the Claude model from the hero input
trailing row. Reads and persists studio.model via /api/settings so the
hero and Settings modal stay in sync.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `HeroPromptInput` component

The centerpiece — borderless textarea with progressive font-shrink, accent bar, attachments row, `@Computer` mentions, Figma URL detection, image paste/drop (via the staging endpoint), model selector, and send button. It calls `props.onSubmit({ prompt, imagePaths, figmaUrl })` and lets the route handle project creation.

**Files:**
- Create: `studio/src/components/home/HeroPromptInput.tsx`
- Create: `studio/__tests__/components/home/hero-prompt-input.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/home/hero-prompt-input.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { HeroPromptInput } from "../../../src/components/home/HeroPromptInput";

beforeEach(() => {
  // Stub /api/settings so the model selector's initial fetch resolves.
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/settings")) {
      return new Response(JSON.stringify({ studio: { model: "sonnet" } }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HeroPromptInput", () => {
  it("renders the placeholder text", () => {
    render(<HeroPromptInput onSubmit={vi.fn()} />);
    expect(screen.getByPlaceholderText(/what we're building today/i)).toBeTruthy();
  });

  it("disables the send button when the input is empty", () => {
    render(<HeroPromptInput onSubmit={vi.fn()} />);
    const send = screen.getByRole("button", { name: /send/i });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables send and calls onSubmit with the prompt when Enter pressed", () => {
    const onSubmit = vi.fn();
    render(<HeroPromptInput onSubmit={onSubmit} />);
    const textarea = screen.getByPlaceholderText(/what we're building today/i);

    fireEvent.change(textarea, { target: { value: "a landing page" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      prompt: "a landing page",
      imagePaths: [],
      figmaUrl: null,
    });
  });

  it("Shift+Enter inserts a newline instead of submitting", () => {
    const onSubmit = vi.fn();
    render(<HeroPromptInput onSubmit={onSubmit} />);
    const textarea = screen.getByPlaceholderText(/what we're building today/i);

    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shrinks font-size when scrollHeight exceeds the max", () => {
    render(<HeroPromptInput onSubmit={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/what we're building today/i) as HTMLTextAreaElement;

    // jsdom returns 0 for scrollHeight; stub it high enough to force a shrink.
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => 400,
    });

    act(() => {
      fireEvent.change(textarea, { target: { value: "some long prompt" } });
    });

    const size = parseFloat(getComputedStyle(textarea).fontSize);
    expect(size).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm run studio:test __tests__/components/home/hero-prompt-input.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `studio/src/components/home/HeroPromptInput.tsx`:

```tsx
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Button, IconButton, ArrowUpSmall, PlusSmall } from "@xorkavi/arcade-gen";
import { ChatInput } from "../../../prototype-kit/composites/ChatInput";
import { nextFontSize } from "../../lib/nextFontSize";
import { extractFigmaUrl } from "../../lib/figmaUrl";
import { api } from "../../lib/api";
import {
  MentionPopover,
  filterMentions,
  type MentionOption,
} from "../chat/MentionPopover";
import { HeroModelSelector } from "./HeroModelSelector";

const START_FONT = 50;
const FLOOR_FONT = 20;
const STEP_FONT = 2;
const MAX_HEIGHT = 180; // ~3 lines at 50px / 1.2 line-height
const PLACEHOLDER = "What we're building today?";

export interface HeroPromptSubmitArgs {
  prompt: string;
  imagePaths: string[];
  figmaUrl: string | null;
}

export interface HeroPromptInputProps {
  onSubmit: (args: HeroPromptSubmitArgs) => void | Promise<void>;
  disabled?: boolean;
}

function detectMentionAtCaret(value: string, caret: number): { query: string; atIdx: number } | null {
  const slice = value.slice(0, caret);
  const atIdx = slice.lastIndexOf("@");
  if (atIdx === -1) return null;
  const before = atIdx === 0 ? "" : slice[atIdx - 1];
  if (before && !/\s/.test(before)) return null;
  const query = slice.slice(atIdx + 1);
  if (/\s/.test(query)) return null;
  return { query, atIdx };
}

export function HeroPromptInput({ onSubmit, disabled }: HeroPromptInputProps) {
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(START_FONT);
  const [images, setImages] = useState<string[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [figmaUrl, setFigmaUrl] = useState<string | null>(null);
  const [mention, setMention] = useState<{
    query: string;
    atIdx: number;
    anchor: { left: number; bottom: number };
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Progressive font-shrink: measure after render, step size based on overflow.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const measured = el.scrollHeight;
    const nextSize = nextFontSize({
      current: fontSize,
      start: START_FONT,
      floor: FLOOR_FONT,
      step: STEP_FONT,
      measuredHeight: measured,
      maxHeight: MAX_HEIGHT,
    });
    if (nextSize !== fontSize) {
      setFontSize(nextSize);
      return;
    }
    el.style.height = `${Math.min(measured, MAX_HEIGHT)}px`;
    el.style.overflowY = measured > MAX_HEIGHT ? "auto" : "hidden";
  }, [text, fontSize]);

  const hasComputerMention = /@Computer\b/i.test(text);

  function updateMentionFromCaret(next: string, el: HTMLTextAreaElement | null) {
    if (!el) { setMention(null); return; }
    const caret = el.selectionStart ?? next.length;
    const detected = detectMentionAtCaret(next, caret);
    if (!detected || filterMentions(detected.query).length === 0) {
      setMention(null);
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    const left = rect ? rect.left + 24 : 24;
    const bottom = rect ? window.innerHeight - rect.top + 8 : 80;
    setMention({ query: detected.query, atIdx: detected.atIdx, anchor: { left, bottom } });
  }

  function insertMention(option: MentionOption) {
    if (!mention) return;
    const before = text.slice(0, mention.atIdx);
    const afterStart = mention.atIdx + 1 + mention.query.length;
    const after = text.slice(afterStart);
    const insertion = `@${option.token} `;
    const nextValue = `${before}${insertion}${after}`;
    setText(nextValue);
    setMention(null);
    const el = textareaRef.current;
    if (el) {
      const caret = before.length + insertion.length;
      requestAnimationFrame(() => {
        el.focus();
        try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
      });
    }
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setText(next);
    setFigmaUrl(extractFigmaUrl(next));
    updateMentionFromCaret(next, e.target);
  };

  const addFiles = useCallback(async (files: File[] | FileList) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const f of arr) {
      try {
        const { path, url } = await api.stageUpload(f);
        setImages((xs) => [...xs, url]);
        setImagePaths((xs) => [...xs, path]);
      } catch {
        // swallow — the hero stays usable without image attach
      }
    }
  }, []);

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
      return;
    }
    const pasted = e.clipboardData?.getData("text");
    if (pasted) {
      const url = extractFigmaUrl(pasted);
      if (url) setFigmaUrl(url);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const submit = async () => {
    if (mention) return;
    const trimmed = text.trim();
    if (!trimmed || submitting || disabled) return;
    setSubmitting(true);
    try {
      await onSubmit({ prompt: trimmed, imagePaths, figmaUrl });
      setText("");
      setImages([]);
      setImagePaths([]);
      setFigmaUrl(null);
      setFontSize(START_FONT);
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (mention) return; // let the popover handle it
      e.preventDefault();
      void submit();
    }
  };

  const sendDisabled = !text.trim() || submitting || !!disabled;

  return (
    <div
      ref={containerRef}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{ position: "relative" }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div
        aria-hidden
        style={{
          width: 4,
          height: 60,
          background: "var(--fg-neutral-black, #211e20)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      <textarea
        ref={textareaRef}
        value={text}
        onChange={onChange}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        placeholder={PLACEHOLDER}
        rows={1}
        style={{
          width: "100%",
          border: 0,
          outline: 0,
          background: "transparent",
          resize: "none",
          fontFamily: "'Chip_Display_Variable', sans-serif",
          fontWeight: 600,
          color: "var(--fg-neutral-prominent, #211e20)",
          fontSize,
          lineHeight: 1.2,
          opacity: 1,
          transition: "font-size 120ms ease-out",
        }}
        // Placeholder styling relies on the global stylesheet; see
        // studio/src/styles/tailwind.css for ::placeholder opacity:0.48.
        data-hero-input
      />
      {(images.length > 0 || figmaUrl || hasComputerMention) && (
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            marginTop: 16,
            paddingBottom: 4,
          }}
        >
          {hasComputerMention && (
            <ChatInput.ContextAttachment title="Computer" subtitle="DevRev agent" />
          )}
          {images.map((_url, i) => (
            <ChatInput.FileAttachment key={i} kind="IMG" name={`image-${i}`} />
          ))}
          {figmaUrl && (
            <ChatInput.ContextAttachment
              title="Figma frame"
              subtitle={figmaUrl.slice(0, 20) + "…"}
            />
          )}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          marginTop: 24,
        }}
      >
        <HeroModelSelector />
        <IconButton
          aria-label="Add attachment"
          variant="secondary"
          size="md"
          onClick={() => fileInputRef.current?.click()}
        >
          <PlusSmall />
        </IconButton>
        <Button
          type="button"
          variant="expressive"
          aria-label="Send"
          onClick={() => void submit()}
          disabled={sendDisabled}
          className="shrink-0 w-9 h-9 p-0"
        >
          <ArrowUpSmall size={18} />
        </Button>
      </div>
      {mention && (
        <MentionPopover
          query={mention.query}
          anchor={mention.anchor}
          onSelect={insertMention}
          onDismiss={() => setMention(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add placeholder opacity to the global stylesheet**

Open `studio/src/styles/tailwind.css`. Append at the very end:

```css
/* Hero input placeholder: same text treatment as typed text, 48% opacity. */
textarea[data-hero-input]::placeholder {
  color: var(--fg-neutral-prominent, #211e20);
  opacity: 0.48;
}
```

- [ ] **Step 5: Re-run the test**

Run: `pnpm run studio:test __tests__/components/home/hero-prompt-input.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/home/HeroPromptInput.tsx \
        studio/src/styles/tailwind.css \
        studio/__tests__/components/home/hero-prompt-input.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/home): add HeroPromptInput component

Borderless hero textarea with progressive font-shrink, accent bar,
attachment row, @Computer mentions, Figma URL detection, image
paste/drop (via staging endpoint), model selector, and send button.
Submit delegates to the caller; the component clears itself on success.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `ProjectsSection` component

Pure presentation: a heading + 3-column grid of existing `ProjectCard`s. Returns `null` when there are zero projects, so the homepage reads as hero-only on first launch.

**Files:**
- Create: `studio/src/components/home/ProjectsSection.tsx`
- Create: `studio/__tests__/components/home/projects-section.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/home/projects-section.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectsSection } from "../../../src/components/home/ProjectsSection";
import type { Project } from "../../../server/types";

function fixture(overrides: Partial<Project> = {}): Project {
  return {
    slug: "demo",
    name: "Demo",
    theme: "arcade",
    mode: "light",
    createdAt: new Date("2026-01-01").toISOString(),
    updatedAt: new Date("2026-01-01").toISOString(),
    frames: [],
    ...overrides,
  } as Project;
}

describe("ProjectsSection", () => {
  it("renders nothing when there are zero projects", () => {
    const { container } = render(
      <ProjectsSection projects={[]} onOpen={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the heading and one card per project", () => {
    render(
      <ProjectsSection
        projects={[fixture({ slug: "a", name: "Alpha" }), fixture({ slug: "b", name: "Beta" })]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: /projects/i })).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm run studio:test __tests__/components/home/projects-section.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `studio/src/components/home/ProjectsSection.tsx`:

```tsx
import type { Project } from "../../../server/types";
import { ProjectCard } from "../projects/ProjectCard";

export interface ProjectsSectionProps {
  projects: Project[];
  onOpen: (slug: string) => void;
  onRename: (project: Project) => void | Promise<void>;
  onDelete: (project: Project) => void | Promise<void>;
}

export function ProjectsSection({ projects, onOpen, onRename, onDelete }: ProjectsSectionProps) {
  if (projects.length === 0) return null;

  return (
    <section>
      <h2
        style={{
          margin: 0,
          marginBottom: 16,
          fontFamily: "'Chip_Display_Variable', sans-serif",
          fontWeight: 600,
          fontSize: 27,
          lineHeight: "36px",
          color: "var(--fg-neutral-prominent, #211e20)",
        }}
      >
        Projects
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 16,
        }}
      >
        {projects.map((p) => (
          <ProjectCard
            key={p.slug}
            project={p}
            onOpen={() => onOpen(p.slug)}
            onRename={() => onRename(p)}
            onDelete={() => onDelete(p)}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Re-run the test**

Run: `pnpm run studio:test __tests__/components/home/projects-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/home/ProjectsSection.tsx \
        studio/__tests__/components/home/projects-section.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/home): add ProjectsSection component

Compact 3-column gallery that renders existing ProjectCards below the
hero input. Returns null when there are zero projects so first-launch
is hero-only.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `HomePage` route

Composes the header, hero, and projects section. Owns `useProjects`, the toast calls, and the submit handler that creates a project, adopts staged uploads, stashes the pending prompt, and opens the new project.

**Files:**
- Create: `studio/src/routes/HomePage.tsx`
- Delete: `studio/src/routes/ProjectList.tsx`

- [ ] **Step 1: Create `HomePage.tsx`**

Create `studio/src/routes/HomePage.tsx`:

```tsx
import { useState } from "react";
import { useToast } from "@xorkavi/arcade-gen";
import { useProjects } from "../hooks/useProjects";
import { usePendingPrompt } from "../hooks/pendingPromptContext";
import { api } from "../lib/api";
import { deriveProjectName } from "../lib/deriveProjectName";
import { StudioHeader } from "../components/shell/StudioHeader";
import { AppSettingsButton } from "../components/shell/SettingsButton";
import { HeroPromptInput, type HeroPromptSubmitArgs } from "../components/home/HeroPromptInput";
import { ProjectsSection } from "../components/home/ProjectsSection";
import type { Project } from "../../server/types";

export function HomePage({ onOpen }: { onOpen: (slug: string) => void }) {
  const { projects, refresh } = useProjects();
  const { toast } = useToast();
  const { set: setPending } = usePendingPrompt();
  const [submitting, setSubmitting] = useState(false);

  async function handleHeroSubmit(args: HeroPromptSubmitArgs) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const name = deriveProjectName(args.prompt);
      const project = await api.createProject({ name, theme: "arcade", mode: "light" });

      let imagePaths = args.imagePaths;
      if (imagePaths.length > 0) {
        const adoption = await api.adoptUploads(project.slug, imagePaths);
        imagePaths = imagePaths.map((old) => adoption.mapping[old] ?? old);
        if (adoption.missing.length > 0) {
          toast({
            title: `Couldn't attach ${adoption.missing.length} image${adoption.missing.length === 1 ? "" : "s"}`,
            intent: "alert",
          });
        }
      }

      setPending({ prompt: args.prompt, imagePaths, figmaUrl: args.figmaUrl });
      void refresh();
      onOpen(project.slug);
    } catch (e) {
      toast({
        title: "Failed to create project",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRename(p: Project) {
    const next = prompt("New name", p.name);
    if (!next || !next.trim()) return;
    try {
      await api.renameProject(p.slug, next.trim());
      void refresh();
      toast({ title: "Project renamed", intent: "success" });
    } catch (e) {
      toast({
        title: "Rename failed",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    }
  }

  async function handleDelete(p: Project) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteProject(p.slug);
      void refresh();
      toast({ title: "Project deleted", intent: "success" });
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <StudioHeader title="Studio" right={<AppSettingsButton />} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div
          style={{
            maxWidth: 800,
            margin: "0 auto",
            padding: "120px 24px 48px",
            display: "flex",
            flexDirection: "column",
            gap: 160,
          }}
        >
          <HeroPromptInput onSubmit={handleHeroSubmit} disabled={submitting} />
          <ProjectsSection
            projects={projects}
            onOpen={onOpen}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete `ProjectList.tsx`**

```bash
rm studio/src/routes/ProjectList.tsx
```

- [ ] **Step 3: Skip the rename test for now**

The old `ProjectList` component had no dedicated test file, and this step only adds a new route and removes the old one. We verify in the next task by running the whole suite after App.tsx is updated.

- [ ] **Step 4: Commit**

```bash
git add studio/src/routes/HomePage.tsx studio/src/routes/ProjectList.tsx
git commit -m "$(cat <<'EOF'
feat(studio/home): add HomePage route (replaces ProjectList)

New homepage composing StudioHeader, HeroPromptInput, and the compact
ProjectsSection. On hero submit: creates a project, adopts staged
uploads, stashes the pending prompt for ChatPane, and navigates.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire `App.tsx` to mount the provider and render `HomePage`

App-level swap: wrap the children of `StartupAuthGate` in `PendingPromptProvider` and render `HomePage` instead of `ProjectList`.

**Files:**
- Modify: `studio/src/App.tsx`

- [ ] **Step 1: Edit `App.tsx`**

Open `studio/src/App.tsx`. Change the import from:

```ts
import { ProjectList } from "./routes/ProjectList";
```

to:

```ts
import { HomePage } from "./routes/HomePage";
import { PendingPromptProvider } from "./hooks/pendingPromptContext";
```

Then change the JSX. Replace this block:

```tsx
      <StartupAuthGate>
        {openSlug === null ? (
          <ProjectList onOpen={openProject} />
        ) : (
          <ProjectDetail
            slug={openSlug}
            onBack={closeProject}
            onOpenProject={openProject}
          />
        )}
      </StartupAuthGate>
```

with:

```tsx
      <StartupAuthGate>
        <PendingPromptProvider>
          {openSlug === null ? (
            <HomePage onOpen={openProject} />
          ) : (
            <ProjectDetail
              slug={openSlug}
              onBack={closeProject}
              onOpenProject={openProject}
            />
          )}
        </PendingPromptProvider>
      </StartupAuthGate>
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm run studio:test`
Expected: all tests pass (~170+ including the ones added in this plan). Any failure here is either a wiring regression or a test that still imports the deleted `ProjectList` path — fix inline.

- [ ] **Step 3: Manual smoke test**

Run: `pnpm run studio`
Expected:
- Browser opens at `http://localhost:5556`.
- Homepage shows the `Studio` header (settings gear top-right), the vertical accent bar, the `What we're building today?` placeholder at 50px / 48% opacity.
- Type a long prompt — font shrinks smoothly, then scrolls once at the floor.
- Paste an image — it uploads to staging, chip appears.
- Paste a Figma URL — Figma chip appears.
- Type `@Computer` — mention popover shows, selecting inserts `@Computer `.
- The model selector shows `Auto` initially, switching to another model persists across reloads.
- Hit send — project gets created, app navigates to the new project, the chat pane fires the first turn with the prompt (and image paths if any).
- Existing projects appear below the hero as a 3-column grid.

- [ ] **Step 4: Commit**

```bash
git add studio/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(studio): swap ProjectList for HomePage and mount PendingPromptProvider

Wires the new branded homepage into App.tsx and adds the pending-prompt
provider so ChatPane can pick up the hero's first turn after navigation.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Bump version and changelog entry

A user-visible homepage shift warrants a minor-version bump and a changelog entry so beta testers see "What's new."

**Files:**
- Modify: `studio/packaging/VERSION`
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Bump VERSION**

Replace the contents of `studio/packaging/VERSION` with:

```
0.7.0
```

- [ ] **Step 2: Add changelog entry**

Open `studio/CHANGELOG.md`. Immediately below the top-level heading (and above the previous `## [0.6.0]` entry, or whichever version is currently at the top), insert:

```markdown
## [0.7.0] — 2026-05-04

### Added
- Branded homepage with a hero prompt input. Type what you want to build and
  hit send — Studio creates a new project named after your prompt and fires
  the first turn automatically.
- Model selector in the hero input. Picks the same `studio.model` setting as
  the Settings modal.
- Image paste/drop, Figma URL pastes, and `@Computer` mentions all work in
  the hero input before a project exists.

### Changed
- The project list now sits below the hero as a compact 3-column gallery.
  The explicit "+ New project" button and search input on the homepage have
  been removed — the hero input replaces both creation paths.
```

- [ ] **Step 3: Verify the full suite one more time**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add studio/packaging/VERSION studio/CHANGELOG.md
git commit -m "$(cat <<'EOF'
chore(studio): bump to 0.7.0

Version bump + changelog entry for the branded homepage feature.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

Coverage against the spec:

- Hero input borderless + progressive font shrink → Task 9 + Task 2 (pure helper).
- Placeholder 50px / opacity 0.48, typed opacity 1 → Task 9 (inline style + tailwind.css rule).
- Model selector reads/writes `studio.model` → Task 8.
- Attachments parity except target chips (images, Figma, @Computer) → Task 9.
- Project name derived from prompt → Task 1.
- Staging uploads + adopt flow → Tasks 3 + 4.
- PendingPromptContext handoff → Tasks 6 + 7.
- 3-col compact gallery, null when empty → Task 10.
- Header stays, no + New project / search → Task 11.
- Version + changelog → Task 13.

No placeholders — every task contains the actual code. Type names are consistent across tasks (`HeroPromptSubmitArgs`, `PendingPrompt`, `deriveProjectName`).

Scope: still one cohesive plan — hero, gallery, new endpoints, and the narrow `ChatPane` change are the minimum set to ship this feature. If testing surfaces that the `PromptInput` refactor-to-shared-hook is needed for maintainability, that's a follow-up PR.
