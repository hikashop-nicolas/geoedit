import { describe, it, expect } from "vitest";
import { haversine, pathLength, ringArea, formatDistance, formatArea } from "./measure";

describe("measure", () => {
  it("haversine matches a known distance (Paris → London ≈ 344 km)", () => {
    const paris: [number, number] = [2.3522, 48.8566];
    const london: [number, number] = [-0.1276, 51.5072];
    const km = haversine(paris, london) / 1000;
    expect(km).toBeGreaterThan(330);
    expect(km).toBeLessThan(355);
  });

  it("pathLength sums segments", () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 1];
    const two = pathLength([a, b, a]);
    expect(two).toBeCloseTo(2 * haversine(a, b), 3);
  });

  it("ringArea of a 1°×1° box near the equator is ~1.23e10 m²", () => {
    const box = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const a = ringArea(box);
    expect(a).toBeGreaterThan(1.2e10);
    expect(a).toBeLessThan(1.25e10);
  });

  it("formats distance and area", () => {
    expect(formatDistance(500)).toBe("500 m");
    expect(formatDistance(2500)).toBe("2.50 km");
    expect(formatArea(2e6)).toBe("2.00 km²");
  });
});
