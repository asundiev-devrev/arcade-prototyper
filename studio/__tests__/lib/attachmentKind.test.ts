// @vitest-environment node
import { describe, it, expect } from "vitest";
import { attachmentKind } from "../../src/lib/attachmentKind";

describe("attachmentKind", () => {
  it("returns IMG for image extensions", () => {
    for (const n of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.svg"]) {
      expect(attachmentKind(n)).toBe("IMG");
    }
  });

  it("returns the uppercased extension for documents", () => {
    expect(attachmentKind("Product Requirements.pdf")).toBe("PDF");
    expect(attachmentKind("spec.docx")).toBe("DOCX");
    expect(attachmentKind("notes.md")).toBe("MD");
  });

  it("returns FILE when there is no extension", () => {
    expect(attachmentKind("README")).toBe("FILE");
    expect(attachmentKind("")).toBe("FILE");
    expect(attachmentKind(undefined)).toBe("FILE");
  });

  it("caps very long extensions to 5 chars", () => {
    expect(attachmentKind("archive.superlongext")).toBe("SUPER");
  });
});
