import { describe, it, expect } from "vitest";
import { placeholderTint } from "../../server/thumbnails";

describe("placeholderTint", () => {
  it("returns arcade-themed gradient for arcade theme", () => {
    expect(placeholderTint("arcade")).toBe(
      "linear-gradient(135deg, #F5F2EF, #E6DFD6)",
    );
  });

  it("returns devrev-app-themed gradient for devrev-app theme", () => {
    expect(placeholderTint("devrev-app")).toBe(
      "linear-gradient(135deg, #E8EEFB, #D3DEF4)",
    );
  });
});
