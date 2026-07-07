import { describe, it, expect } from "vitest";
import { shouldRetryBoot, bootErrorHtml, BOOT_MAX_ATTEMPTS } from "../../../electron/bootError";

describe("shouldRetryBoot", () => {
  it("retries while under the attempt cap", () => {
    expect(shouldRetryBoot(1, 2)).toBe(true);
  });
  it("stops at the cap", () => {
    expect(shouldRetryBoot(2, 2)).toBe(false);
    expect(shouldRetryBoot(3, 2)).toBe(false);
  });
  it("defaults the cap to 2", () => {
    expect(BOOT_MAX_ATTEMPTS).toBe(2);
  });
});

describe("bootErrorHtml", () => {
  const html = bootErrorHtml("/Users/x/Library/Logs/arcade-studio-electron.log");
  it("names the app and the failure", () => {
    expect(html).toMatch(/Arcade Studio/);
    expect(html.toLowerCase()).toMatch(/couldn.?t start|failed to start/);
  });
  it("shows the log path so a tester can report it", () => {
    expect(html).toContain("/Users/x/Library/Logs/arcade-studio-electron.log");
  });
  it("offers Quit via window.close (no IPC)", () => {
    expect(html).toContain("window.close()");
    expect(html.toLowerCase()).toContain("quit");
  });
  it("escapes the log path into an attribute-safe/text-safe form", () => {
    const evil = bootErrorHtml(`</script><img src=x onerror=alert(1)>`);
    expect(evil).not.toContain("<img src=x");
  });
});
