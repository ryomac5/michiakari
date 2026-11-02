import { describe, expect, it } from "vitest";
import {
  type IsochroneGeometry,
  isPointInGeometry,
  isPointInRing,
  type LonLat,
} from "../src/index.ts";

// 0〜10 の正方形と、その中の 4〜6 の穴
const square: LonLat[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];
const hole: LonLat[] = [
  [4, 4],
  [6, 4],
  [6, 6],
  [4, 6],
  [4, 4],
];

describe("isPointInRing", () => {
  it("内側の点は true、外側の点は false", () => {
    expect(isPointInRing([5, 5], square)).toBe(true);
    expect(isPointInRing([11, 5], square)).toBe(false);
    expect(isPointInRing([5, -1], square)).toBe(false);
  });

  it("閉じていない環でも同じ結果になる", () => {
    expect(isPointInRing([5, 5], square.slice(0, 4))).toBe(true);
    expect(isPointInRing([11, 5], square.slice(0, 4))).toBe(false);
  });

  it("凹んだ環の、凹みの部分は外側", () => {
    const cShape: LonLat[] = [
      [0, 0],
      [10, 0],
      [10, 3],
      [3, 3],
      [3, 7],
      [10, 7],
      [10, 10],
      [0, 10],
    ];
    expect(isPointInRing([1, 5], cShape)).toBe(true);
    expect(isPointInRing([6, 5], cShape)).toBe(false);
  });
});

describe("isPointInGeometry", () => {
  it("Polygon の穴の中は外側として扱う", () => {
    const polygon: IsochroneGeometry = { type: "Polygon", coordinates: [square, hole] };
    expect(isPointInGeometry([2, 2], polygon)).toBe(true);
    expect(isPointInGeometry([5, 5], polygon)).toBe(false);
    expect(isPointInGeometry([20, 20], polygon)).toBe(false);
  });

  it("MultiPolygon はどれか 1 つに入っていれば内側", () => {
    const shifted = square.map(([x, y]) => [x + 20, y] as LonLat);
    const multi: IsochroneGeometry = { type: "MultiPolygon", coordinates: [[square], [shifted]] };
    expect(isPointInGeometry([5, 5], multi)).toBe(true);
    expect(isPointInGeometry([25, 5], multi)).toBe(true);
    expect(isPointInGeometry([15, 5], multi)).toBe(false);
  });

  it("空の多角形には何も入らない", () => {
    expect(isPointInGeometry([0, 0], { type: "Polygon", coordinates: [] })).toBe(false);
  });
});
