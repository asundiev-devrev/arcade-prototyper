// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveUploadExtension, decodeUploadFilename } from "../../server/uploadFilename";

describe("resolveUploadExtension", () => {
  it("prefers the original filename's extension", () => {
    expect(resolveUploadExtension("Product Requirements.pdf", "application/octet-stream")).toBe("pdf");
    expect(resolveUploadExtension("spec.docx", "application/octet-stream")).toBe("docx");
    expect(resolveUploadExtension("notes.MD", "text/markdown")).toBe("md");
  });

  it("falls back to the MIME subtype when there is no filename", () => {
    expect(resolveUploadExtension(undefined, "image/png")).toBe("png");
    expect(resolveUploadExtension(undefined, "application/pdf")).toBe("pdf");
  });

  it("maps image/svg+xml to svg", () => {
    expect(resolveUploadExtension(undefined, "image/svg+xml")).toBe("svg");
  });

  it("sanitizes the extension to [a-z0-9] so it cannot carry path separators", () => {
    // A filename whose 'extension' is a traversal attempt yields safe chars only.
    const ext = resolveUploadExtension("evil.../../passwd", "application/octet-stream");
    expect(ext).toMatch(/^[a-z0-9]*$/);
    expect(ext).not.toContain("/");
    expect(ext).not.toContain(".");
  });

  it("returns 'bin' when neither filename nor MIME yields a usable extension", () => {
    expect(resolveUploadExtension(undefined, "application/octet-stream")).toBe("bin");
    expect(resolveUploadExtension("README", undefined)).toBe("bin");
  });

  it("does not return an absurdly long extension from a verbose MIME subtype", () => {
    const ext = resolveUploadExtension(
      undefined,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    // Too long to be a real extension → falls back to bin.
    expect(ext).toBe("bin");
  });
});

describe("decodeUploadFilename", () => {
  it("decodes a percent-encoded header value", () => {
    expect(decodeUploadFilename(encodeURIComponent("My File ®.pdf"))).toBe("My File ®.pdf");
  });

  it("takes the first value when the header is an array", () => {
    expect(decodeUploadFilename(["a.txt", "b.txt"])).toBe("a.txt");
  });

  it("returns undefined for a missing header", () => {
    expect(decodeUploadFilename(undefined)).toBeUndefined();
  });
});
