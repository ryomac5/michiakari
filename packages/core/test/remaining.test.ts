import { describe, expect, it } from "vitest";
import { sampleStatsRemaining } from "../src/incident-stats.ts";
import { computeQuantile, sampleDurationDist, summarizeSamples } from "../src/remaining.ts";

// 残り時間の標本と分位点。所要時間の分布は架空の値

// 所要時間の分布と発生からの経過から、残りの p50・p80 を返す
function estimateFromDist(dist: { p50: number; p80: number }, elapsed: number) {
  return summarizeSamples(sampleStatsRemaining(dist, elapsed));
}

describe("computeQuantile", () => {
  it("線形補間で分位点を返す", () => {
    const sorted = [1, 2, 3, 4];
    expect(computeQuantile(sorted, 0)).toBe(1);
    expect(computeQuantile(sorted, 0.5)).toBe(2.5);
    expect(computeQuantile(sorted, 1)).toBe(4);
  });

  it("要素が 1 つならその値", () => {
    expect(computeQuantile([7], 0.8)).toBe(7);
  });

  it("空なら例外", () => {
    expect(() => computeQuantile([], 0.5)).toThrow(RangeError);
  });
});

describe("summarizeSamples と sampleStatsRemaining", () => {
  it("定数の分布は、所要から経過を引いた残りそのもの", () => {
    expect(estimateFromDist({ p50: 35, p80: 35 }, 0)).toEqual({ p50: 35, p80: 35 });
    expect(estimateFromDist({ p50: 35, p80: 35 }, 3)).toEqual({ p50: 32, p80: 32 });
  });

  it("定数の所要を超えて経過したら、残りは 0", () => {
    expect(estimateFromDist({ p50: 35, p80: 35 }, 35)).toEqual({ p50: 0, p80: 0 });
    expect(estimateFromDist({ p50: 35, p80: 35 }, 60)).toEqual({ p50: 0, p80: 0 });
  });

  it("すべて 0 分なら 0 分", () => {
    expect(estimateFromDist({ p50: 0, p80: 0 }, 0)).toEqual({ p50: 0, p80: 0 });
    expect(estimateFromDist({ p50: 0, p80: 0 }, 30)).toEqual({ p50: 0, p80: 0 });
  });

  it("経過 0 分なら p50 と p80 が分布の値に近い", () => {
    const result = estimateFromDist({ p50: 10, p80: 20 }, 0);
    expect(Math.abs(result.p50 - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.p80 - 20)).toBeLessThanOrEqual(1);
  });

  it("同じ入力なら常に同じ出力", () => {
    expect(estimateFromDist({ p50: 20, p80: 40 }, 7)).toEqual(
      estimateFromDist({ p50: 20, p80: 40 }, 7),
    );
  });

  it("結果は整数で p80 ≥ p50", () => {
    for (const elapsed of [0, 5, 30, 120]) {
      const { p50, p80 } = estimateFromDist({ p50: 45, p80: 80 }, elapsed);
      expect(Number.isInteger(p50)).toBe(true);
      expect(Number.isInteger(p80)).toBe(true);
      expect(p80).toBeGreaterThanOrEqual(p50);
    }
  });

  it("経過が p80 を大きく超えても破綻せず、条件付き分布の長い裾で残りが伸びる", () => {
    const at30 = estimateFromDist({ p50: 10, p80: 20 }, 30);
    const at120 = estimateFromDist({ p50: 10, p80: 20 }, 120);
    const at1000 = estimateFromDist({ p50: 10, p80: 20 }, 1000);
    expect(at30.p50).toBeGreaterThan(0);
    expect(at120.p50).toBeGreaterThan(at30.p50);
    expect(at1000.p50).toBeGreaterThan(at120.p50);
    expect(at1000.p80).toBeGreaterThan(at1000.p50);
    expect(Number.isFinite(at1000.p80)).toBe(true);
  });

  it("経過が極端に長くても有限の値を返す", () => {
    const result = estimateFromDist({ p50: 10, p80: 20 }, 1_000_000);
    expect(Number.isFinite(result.p50)).toBe(true);
    expect(Number.isFinite(result.p80)).toBe(true);
    expect(result.p50).toBeGreaterThan(0);
  });

  it("p50 が 0 で p80 が正の分布も扱える", () => {
    const { p50, p80 } = estimateFromDist({ p50: 0, p80: 10 }, 0);
    expect(p50).toBeLessThanOrEqual(1);
    expect(Math.abs(p80 - 10)).toBeLessThanOrEqual(1);
  });

  it("経過時間が負または有限でないなら例外", () => {
    expect(() => sampleStatsRemaining({ p50: 10, p80: 20 }, -1)).toThrow(RangeError);
    expect(() => sampleStatsRemaining({ p50: 10, p80: 20 }, Number.NaN)).toThrow(RangeError);
    expect(() => sampleStatsRemaining({ p50: 10, p80: 20 }, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});

describe("sampleDurationDist", () => {
  it("足す分だけ標本を後ろへずらし、昇順を保つ", () => {
    const base = sampleDurationDist({ p50: 5, p80: 15 });
    const shifted = sampleDurationDist({ p50: 5, p80: 15 }, 20);
    expect(shifted).toHaveLength(base.length);
    expect(shifted.every((v, i) => v === (base[i] ?? 0) + 20)).toBe(true);
    for (let i = 1; i < shifted.length; i++) {
      expect(shifted[i]).toBeGreaterThanOrEqual(shifted[i - 1] ?? 0);
    }
  });

  it("足す分が負または有限でないなら例外", () => {
    expect(() => sampleDurationDist({ p50: 5, p80: 15 }, -1)).toThrow(RangeError);
    expect(() => sampleDurationDist({ p50: 5, p80: 15 }, Number.NaN)).toThrow(RangeError);
  });
});
