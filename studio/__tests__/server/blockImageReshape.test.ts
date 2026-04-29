// @vitest-environment node
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { shouldBlock } from "../../server/hooks/blockImageReshape.mjs";

describe("blockImageReshape.shouldBlock", () => {
  it("blocks sips transforms (resample / crop / rotate)", () => {
    expect(shouldBlock(`sips -z 800 600 in.png --out out.png`)).toBe(true);
    expect(shouldBlock(`sips -Z 1600 foo.png --out bar.png`)).toBe(true);
    expect(shouldBlock(`sips -c 400 400 in.png --out crop.png`)).toBe(true);
    expect(shouldBlock(`sips --resampleWidth 1600 in.png --out out.png`)).toBe(true);
    expect(shouldBlock(`sips --cropToHeightWidth 100 100 in.png --out out.png`)).toBe(true);
  });

  it("allows sips metadata reads", () => {
    expect(shouldBlock(`sips -g pixelWidth -g pixelHeight foo.png`)).toBe(false);
    expect(shouldBlock(`sips --getProperty pixelWidth foo.png`)).toBe(false);
  });

  it("blocks ImageMagick family", () => {
    expect(shouldBlock(`magick in.png -resize 800x out.png`)).toBe(true);
    expect(shouldBlock(`convert in.png -crop 400x400+0+0 out.png`)).toBe(true);
    expect(shouldBlock(`mogrify -resize 50% in.png`)).toBe(true);
    expect(shouldBlock(`gm convert in.png -resize 800 out.png`)).toBe(true);
  });

  it("blocks python inline scripts that import imaging libs", () => {
    expect(
      shouldBlock(`python3 -c "from PIL import Image; Image.open('x.png').resize((800,600)).save('y.png')"`),
    ).toBe(true);
    expect(
      shouldBlock(`python3 -c "import cv2; cv2.imwrite('y.png', cv2.imread('x.png'))"`),
    ).toBe(true);
  });

  it("allows python without imaging libs", () => {
    expect(shouldBlock(`python3 -c "print(1 + 1)"`)).toBe(false);
    expect(shouldBlock(`which python3 && python3 -c "import sys; print(sys.version)"`)).toBe(false);
  });

  it("allows unrelated shell commands", () => {
    expect(shouldBlock(`ls -la /tmp`)).toBe(false);
    expect(shouldBlock(`figmanage reading get-nodes --depth 4 abc 131-4224`)).toBe(false);
    expect(shouldBlock(`curl -o img.png https://example.com/x.png`)).toBe(false);
    expect(shouldBlock(`cat foo.tsx | head -20`)).toBe(false);
  });

  it("catches transforms inside compound `cd … && sips …` commands", () => {
    expect(
      shouldBlock(`cd "/tmp/viewimg" && sips -z 400 400 in.png --out out.png`),
    ).toBe(true);
    expect(
      shouldBlock(`cd /tmp && ls && sips --resampleWidth 1600 foo.png --out bar.png`),
    ).toBe(true);
  });

  it("handles non-string / empty input as non-blocking", () => {
    expect(shouldBlock(undefined)).toBe(false);
    expect(shouldBlock("")).toBe(false);
    expect(shouldBlock(null as unknown as string)).toBe(false);
  });
});
