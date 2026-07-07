import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StudioBrand } from "../../src/components/shell/StudioBrand";

afterEach(() => cleanup());

describe("StudioBrand", () => {
  it("renders the wordmark and a logo image", () => {
    render(<StudioBrand />);
    // Wordmark text renders.
    expect(screen.getByText("Arcade Studio")).toBeTruthy();
    // Logo mark renders as an <img> with a real source (Vite resolves the
    // .svg import to a URL/data-URL string).
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBeTruthy();
    expect((img?.getAttribute("src") ?? "").length).toBeGreaterThan(0);
  });
});
