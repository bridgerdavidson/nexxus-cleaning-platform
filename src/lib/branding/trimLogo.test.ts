import { describe, it, expect } from "vitest";
import { computeContentBox } from "./trimLogo";

/** Builds RGBA pixel data from a per-pixel function. */
function image(
  width: number,
  height: number,
  px: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = px(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const RED: [number, number, number, number] = [200, 20, 20, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

const inRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;

describe("computeContentBox", () => {
  it("trims a white border around opaque content (flattened export)", () => {
    const data = image(100, 100, (x, y) => (inRect(x, y, 30, 40, 59, 69) ? RED : WHITE));
    // 2px keep-margin on each side of the 30x30 content.
    expect(computeContentBox(data, 100, 100)).toEqual({ x: 28, y: 38, width: 34, height: 34 });
  });

  it("trims a transparent border around opaque content", () => {
    const data = image(100, 100, (x, y) => (inRect(x, y, 10, 10, 49, 29) ? RED : CLEAR));
    expect(computeContentBox(data, 100, 100)).toEqual({ x: 8, y: 8, width: 44, height: 24 });
  });

  it("keeps a white-on-transparent logo (near-white rule must not apply)", () => {
    const data = image(100, 100, (x, y) => (inRect(x, y, 20, 20, 79, 79) ? WHITE : CLEAR));
    expect(computeContentBox(data, 100, 100)).toEqual({ x: 18, y: 18, width: 64, height: 64 });
  });

  it("does not white-trim inside a transparent image", () => {
    // Transparent border, content is a white rect: alpha decides, white stays.
    const data = image(60, 60, (x, y) => (inRect(x, y, 15, 15, 44, 44) ? WHITE : CLEAR));
    const box = computeContentBox(data, 60, 60);
    expect(box).toEqual({ x: 13, y: 13, width: 34, height: 34 });
  });

  it("returns null for a blank image", () => {
    expect(computeContentBox(image(50, 50, () => WHITE), 50, 50)).toBeNull();
    expect(computeContentBox(image(50, 50, () => CLEAR), 50, 50)).toBeNull();
  });

  it("returns null when content already fills the canvas (not worth re-encoding)", () => {
    const data = image(100, 100, (x, y) => (inRect(x, y, 1, 1, 98, 98) ? RED : WHITE));
    expect(computeContentBox(data, 100, 100)).toBeNull();
  });

  it("returns null for degenerate slivers of content", () => {
    const data = image(100, 100, (x, y) => (inRect(x, y, 50, 50, 52, 52) ? RED : WHITE));
    expect(computeContentBox(data, 100, 100)).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(computeContentBox(new Uint8ClampedArray(8), 100, 100)).toBeNull();
    expect(computeContentBox(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });

  it("clamps the keep-margin at the canvas edge", () => {
    const data = image(40, 40, (x, y) => (inRect(x, y, 0, 0, 19, 19) ? RED : WHITE));
    expect(computeContentBox(data, 40, 40)).toEqual({ x: 0, y: 0, width: 22, height: 22 });
  });

  it("treats near-white anti-aliasing as padding on opaque images", () => {
    const NEARLY: [number, number, number, number] = [252, 252, 252, 255];
    const data = image(100, 100, (x, y) =>
      inRect(x, y, 30, 30, 69, 69) ? RED : inRect(x, y, 25, 25, 74, 74) ? NEARLY : WHITE,
    );
    expect(computeContentBox(data, 100, 100)).toEqual({ x: 28, y: 28, width: 44, height: 44 });
  });
});
