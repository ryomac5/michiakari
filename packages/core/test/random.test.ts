import { describe, expect, it } from "vitest";
import {
  createMulberry32,
  sampleStandardNormal,
  sampleTruncatedStandardNormal,
} from "../src/random.ts";

function drawMany(count: number, draw: () => number): number[] {
  return Array.from({ length: count }, draw);
}

describe("createMulberry32", () => {
  it("同じシードなら同じ列を返す", () => {
    const a = createMulberry32(42);
    const b = createMulberry32(42);
    expect(drawMany(100, a)).toEqual(drawMany(100, b));
  });

  it("違うシードなら違う列を返す", () => {
    expect(drawMany(10, createMulberry32(1))).not.toEqual(drawMany(10, createMulberry32(2)));
  });

  it("[0, 1) の値を返す", () => {
    const values = drawMany(10_000, createMulberry32(7));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
  });
});

describe("sampleStandardNormal", () => {
  it("平均 0、分散 1 に近い", () => {
    const random = createMulberry32(3);
    const values = drawMany(20_000, () => sampleStandardNormal(random));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });
});

describe("sampleTruncatedStandardNormal", () => {
  it.each([-2, -0.5, 0, 0.5, 2, 10, 40])("下限 %d より大きい値だけを返す", (lower) => {
    const random = createMulberry32(11);
    const values = drawMany(2_000, () => sampleTruncatedStandardNormal(random, lower));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(lower);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  it("下限 0 の中央値は 0.674 に近い（半正規分布）", () => {
    const random = createMulberry32(5);
    const values = drawMany(20_000, () => sampleTruncatedStandardNormal(random, 0)).sort(
      (a, b) => a - b,
    );
    expect(values[10_000]).toBeCloseTo(0.6745, 1);
  });

  it("下限が大きいと下限のすぐ上に集まる", () => {
    const random = createMulberry32(5);
    const values = drawMany(5_000, () => sampleTruncatedStandardNormal(random, 10));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    // 切断正規の平均はおよそ a + 1/a
    expect(mean).toBeCloseTo(10.098, 1);
  });
});
