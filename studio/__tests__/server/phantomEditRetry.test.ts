// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  isMemoryOnlyPrompt,
  shouldRetryPhantomEdit,
  PHANTOM_EDIT_RETRY_PROMPT,
} from "../../server/phantomEditRetry";

describe("isMemoryOnlyPrompt", () => {
  it("matches a bare remember: directive", () => {
    expect(isMemoryOnlyPrompt("remember: always use teal accents")).toBe(true);
  });
  it("matches case-insensitively and ignores leading whitespace", () => {
    expect(isMemoryOnlyPrompt("  REMEMBER: x")).toBe(true);
  });
  it("does not match a normal edit prompt", () => {
    expect(isMemoryOnlyPrompt("make the header red")).toBe(false);
  });
  it("does not match 'remember' used mid-sentence", () => {
    expect(isMemoryOnlyPrompt("please remember to add a footer")).toBe(false);
  });
});

describe("shouldRetryPhantomEdit", () => {
  const base = { fileChanged: false, claimsEdit: true, memoryOnly: false, alreadyRetried: false };

  it("retries when the agent claimed an edit but no file moved", () => {
    expect(shouldRetryPhantomEdit(base)).toBe(true);
  });
  it("does not retry when a file actually changed", () => {
    expect(shouldRetryPhantomEdit({ ...base, fileChanged: true })).toBe(false);
  });
  it("does not retry a turn with no Deviations section (e.g. a flow question)", () => {
    expect(shouldRetryPhantomEdit({ ...base, claimsEdit: false })).toBe(false);
  });
  it("does not retry a bare remember: turn", () => {
    expect(shouldRetryPhantomEdit({ ...base, memoryOnly: true })).toBe(false);
  });
  it("does not retry more than once (one-shot guard)", () => {
    expect(shouldRetryPhantomEdit({ ...base, alreadyRetried: true })).toBe(false);
  });
});

describe("PHANTOM_EDIT_RETRY_PROMPT", () => {
  it("instructs the agent to re-read and actually edit", () => {
    expect(PHANTOM_EDIT_RETRY_PROMPT).toMatch(/re-read/i);
    expect(PHANTOM_EDIT_RETRY_PROMPT).toMatch(/Edit tool/i);
    expect(PHANTOM_EDIT_RETRY_PROMPT).toMatch(/did not land|no file was actually modified/i);
  });
});
