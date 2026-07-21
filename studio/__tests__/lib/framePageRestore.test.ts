// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { currentPageLabel, findRestoreTarget } from "../../src/lib/framePageRestore";

/**
 * Return-to-your-page helper. The double-buffer swap remounts the frame iframe
 * (so edits show without a refresh), but multi-page frames reset to their
 * default page on remount. These helpers capture the visible page's label and
 * find the nav control to click back to it. Best-effort by design: exact-label
 * match only, graceful no-op (null) when nothing matches — never worse than the
 * default-page reset it's trying to undo.
 */
describe("framePageRestore — currentPageLabel", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("returns the first heading's trimmed text", () => {
    document.body.innerHTML = `<div><h1>  Preferences  </h1><p>x</p></div>`;
    expect(currentPageLabel(document)).toBe("Preferences");
  });

  it("prefers h1 over a later h2", () => {
    document.body.innerHTML = `<h1>Users</h1><h2>Section</h2>`;
    expect(currentPageLabel(document)).toBe("Users");
  });

  it("falls back to h2 when there is no h1", () => {
    document.body.innerHTML = `<h2>Skills</h2>`;
    expect(currentPageLabel(document)).toBe("Skills");
  });

  it("returns null when there is no heading (nothing to restore)", () => {
    document.body.innerHTML = `<div>no heading here</div>`;
    expect(currentPageLabel(document)).toBeNull();
  });

  it("returns null for a null/undefined document", () => {
    expect(currentPageLabel(null)).toBeNull();
    expect(currentPageLabel(undefined)).toBeNull();
  });

  it("returns null for a whitespace-only heading", () => {
    document.body.innerHTML = `<h1>   </h1>`;
    expect(currentPageLabel(document)).toBeNull();
  });
});

describe("framePageRestore — findRestoreTarget", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("finds a button whose exact trimmed label matches", () => {
    document.body.innerHTML = `
      <button>Profile</button>
      <button>  Preferences  </button>
      <button>Users</button>`;
    const el = findRestoreTarget(document, "Preferences");
    expect(el).not.toBeNull();
    expect(el!.textContent!.trim()).toBe("Preferences");
  });

  it("matches an anchor with href and role=tab / role=menuitem", () => {
    document.body.innerHTML = `<a href="#p">Billing</a>`;
    expect(findRestoreTarget(document, "Billing")).not.toBeNull();
    document.body.innerHTML = `<div role="tab">Tab One</div>`;
    expect(findRestoreTarget(document, "Tab One")).not.toBeNull();
    document.body.innerHTML = `<div role="menuitem">Menu Item</div>`;
    expect(findRestoreTarget(document, "Menu Item")).not.toBeNull();
  });

  it("does NOT match a non-interactive element with the same text (avoids clicking a breadcrumb/heading)", () => {
    document.body.innerHTML = `<h1>Preferences</h1><span>Preferences</span>`;
    expect(findRestoreTarget(document, "Preferences")).toBeNull();
  });

  it("requires an EXACT match — never a partial/startsWith (a fuzzy match could open the WRONG page)", () => {
    document.body.innerHTML = `<button>Preferences and Privacy</button>`;
    expect(findRestoreTarget(document, "Preferences")).toBeNull();
  });

  it("returns null when no control matches (→ caller stays on default page)", () => {
    document.body.innerHTML = `<button>Profile</button><button>Users</button>`;
    expect(findRestoreTarget(document, "Preferences")).toBeNull();
  });

  it("returns null for a null label or null document", () => {
    document.body.innerHTML = `<button>Preferences</button>`;
    expect(findRestoreTarget(document, null)).toBeNull();
    expect(findRestoreTarget(null, "Preferences")).toBeNull();
  });

  it("returns the FIRST matching control when labels duplicate", () => {
    document.body.innerHTML = `
      <button id="a">Preferences</button>
      <button id="b">Preferences</button>`;
    const el = findRestoreTarget(document, "Preferences");
    expect(el!.id).toBe("a");
  });
});
