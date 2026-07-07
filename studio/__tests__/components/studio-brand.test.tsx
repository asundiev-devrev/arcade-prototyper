import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StudioBrand } from "../../src/components/shell/StudioBrand";

afterEach(() => cleanup());

describe("StudioBrand", () => {
  it("renders the wordmark and a logo image", () => {
    render(<StudioBrand />);
    expect(screen.getByText("Arcade Studio")).toBeTruthy();
    // The logo mark renders as an <img>.
    expect(document.querySelector("img")).toBeTruthy();
  });
});
