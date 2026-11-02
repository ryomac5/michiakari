import { describe, expect, it } from "vitest";
import { MIN_MEDIAN_MINUTES } from "../params/estimation.ts";
import {
  fitDurationModel,
  sampleDuration,
  sampleRemainingDuration,
} from "../src/duration-model.ts";
import { createMulberry32 } from "../src/random.ts";
import { computeQuantile } from "../src/remaining.ts";

function sampleSorted(count: number, draw: () => number): number[] {
  return Array.from({ length: count }, draw).sort((a, b) => a - b);
}

describe("fitDurationModel", () => {
  it("p50 = p80 なら定数", () => {
    expect(fitDurationModel({ p50: 12, p80: 12 })).toEqual({ kind: "constant", minutes: 12 });
  });

  it("p50 = p80 = 0 なら 0 分の定数", () => {
    expect(fitDurationModel({ p50: 0, p80: 0 })).toEqual({ kind: "constant", minutes: 0 });
  });

  it("mu = ln p50、sigma = (ln p80 − ln p50) / 0.8416", () => {
    const model = fitDurationModel({ p50: 10, p80: 20 });
    if (model.kind !== "lognormal") throw new Error("対数正規ではない");
    expect(model.mu).toBeCloseTo(Math.log(10), 10);
    expect(model.sigma).toBeCloseTo(Math.log(2) / 0.8416212335729143, 10);
  });

  it("p50 が 0 なら下限の中央値を使う", () => {
    const model = fitDurationModel({ p50: 0, p80: 10 });
    if (model.kind !== "lognormal") throw new Error("対数正規ではない");
    expect(model.mu).toBeCloseTo(Math.log(MIN_MEDIAN_MINUTES), 10);
  });

  it("p80 < p50 なら例外", () => {
    expect(() => fitDurationModel({ p50: 20, p80: 10 })).toThrow(RangeError);
  });
});

describe("sampleDuration", () => {
  it("標本の中央値と 80% 点が p50 と p80 に近い", () => {
    const model = fitDurationModel({ p50: 10, p80: 20 });
    const random = createMulberry32(1);
    const values = sampleSorted(20_000, () => sampleDuration(model, random));
    expect(computeQuantile(values, 0.5)).toBeCloseTo(10, 0);
    expect(Math.abs(computeQuantile(values, 0.8) - 20)).toBeLessThan(0.8);
  });

  it("定数モデルは常に同じ値", () => {
    const random = createMulberry32(1);
    expect(sampleDuration({ kind: "constant", minutes: 7 }, random)).toBe(7);
  });
});

describe("sampleRemainingDuration", () => {
  const model = fitDurationModel({ p50: 10, p80: 20 });

  it("経過 0 分なら全量の分布と同じ", () => {
    const a = createMulberry32(9);
    const b = createMulberry32(9);
    expect(sampleRemainingDuration(model, 0, a)).toBe(sampleDuration(model, b));
  });

  it("経過 = p50 のとき、残りの中央値は理論値 10·exp(σ·0.6745) − 10 に近い", () => {
    const random = createMulberry32(2);
    const values = sampleSorted(20_000, () => sampleRemainingDuration(model, 10, random));
    const sigma = Math.log(2) / 0.8416212335729143;
    const expected = 10 * Math.exp(sigma * 0.6744897501960817) - 10;
    expect(Math.abs(computeQuantile(values, 0.5) - expected)).toBeLessThan(0.3);
  });

  it("経過 = p80 のとき、残りの中央値は理論値 10·exp(σ·1.2816) − 20 に近い", () => {
    const random = createMulberry32(2);
    const values = sampleSorted(20_000, () => sampleRemainingDuration(model, 20, random));
    const sigma = Math.log(2) / 0.8416212335729143;
    const expected = 10 * Math.exp(sigma * 1.2815515655446004) - 20;
    expect(Math.abs(computeQuantile(values, 0.5) - expected)).toBeLessThan(0.4);
  });

  it("残りは 0 以上", () => {
    const random = createMulberry32(4);
    for (const elapsed of [0, 1, 10, 100, 10_000]) {
      for (let i = 0; i < 500; i++) {
        expect(sampleRemainingDuration(model, elapsed, random)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("定数モデルは max(所要 − 経過, 0)", () => {
    const random = createMulberry32(1);
    const constant = { kind: "constant", minutes: 10 } as const;
    expect(sampleRemainingDuration(constant, 3, random)).toBe(7);
    expect(sampleRemainingDuration(constant, 10, random)).toBe(0);
    expect(sampleRemainingDuration(constant, 25, random)).toBe(0);
  });
});
