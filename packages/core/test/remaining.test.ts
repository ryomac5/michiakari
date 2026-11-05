import { describe, expect, it } from "vitest";
import { computeQuantile, estimateRemaining, findPhaseIndex } from "../src/remaining.ts";
import {
  constantKnowledge,
  lognormalKnowledge,
  singlePhaseKnowledge,
  zeroKnowledge,
  zeroMedianKnowledge,
} from "./fixtures/knowledge.ts";

describe("findPhaseIndex", () => {
  it("段階 ID の位置を返す", () => {
    expect(findPhaseIndex(lognormalKnowledge, "initial")).toBe(0);
    expect(findPhaseIndex(lognormalKnowledge, "recovering")).toBe(2);
  });

  it("未知の段階 ID なら例外", () => {
    expect(() => findPhaseIndex(lognormalKnowledge, "unknown")).toThrow(RangeError);
  });
});

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

describe("estimateRemaining", () => {
  it("定数の段階は残り + 以降の全量 + 初列車待ちの和そのもの", () => {
    expect(estimateRemaining(constantKnowledge, "first", 0)).toEqual({ p50: 35, p80: 35 });
    expect(estimateRemaining(constantKnowledge, "first", 3)).toEqual({ p50: 32, p80: 32 });
    expect(estimateRemaining(constantKnowledge, "second", 5)).toEqual({ p50: 20, p80: 20 });
  });

  it("定数の段階の所要を超えて経過したら、その段階の残りは 0", () => {
    expect(estimateRemaining(constantKnowledge, "first", 10)).toEqual({ p50: 25, p80: 25 });
    expect(estimateRemaining(constantKnowledge, "first", 60)).toEqual({ p50: 25, p80: 25 });
  });

  it("すべて 0 分なら 0 分", () => {
    expect(estimateRemaining(zeroKnowledge, "only", 0)).toEqual({ p50: 0, p80: 0 });
    expect(estimateRemaining(zeroKnowledge, "only", 30)).toEqual({ p50: 0, p80: 0 });
  });

  it("1 段階・経過 0 分なら p50 と p80 がその段階の値に近い", () => {
    const result = estimateRemaining(singlePhaseKnowledge, "only", 0);
    expect(Math.abs(result.p50 - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.p80 - 20)).toBeLessThanOrEqual(1);
  });

  it("同じ入力なら常に同じ出力", () => {
    const a = estimateRemaining(lognormalKnowledge, "working", 7);
    const b = estimateRemaining(lognormalKnowledge, "working", 7);
    expect(a).toEqual(b);
  });

  it("結果は整数で p80 ≥ p50", () => {
    for (const phase of ["initial", "working", "recovering"]) {
      for (const elapsed of [0, 5, 30, 120]) {
        const { p50, p80 } = estimateRemaining(lognormalKnowledge, phase, elapsed);
        expect(Number.isInteger(p50)).toBe(true);
        expect(Number.isInteger(p80)).toBe(true);
        expect(p80).toBeGreaterThanOrEqual(p50);
      }
    }
  });

  it("後の段階ほど残りは短い", () => {
    const initial = estimateRemaining(lognormalKnowledge, "initial", 0);
    const working = estimateRemaining(lognormalKnowledge, "working", 0);
    const recovering = estimateRemaining(lognormalKnowledge, "recovering", 0);
    expect(initial.p50).toBeGreaterThan(working.p50);
    expect(working.p50).toBeGreaterThan(recovering.p50);
  });

  it("全段階と初列車待ちの和は、各 p50 の和より中央値が大きい（右に歪んだ分布の和）", () => {
    const { p50, p80 } = estimateRemaining(lognormalKnowledge, "initial", 0);
    expect(p50).toBeGreaterThan(10 + 20 + 15 + 5);
    expect(p80).toBeGreaterThan(p50);
  });

  it("経過が p80 を大きく超えても破綻せず、条件付き分布の長い裾で残りが伸びる", () => {
    const at30 = estimateRemaining(singlePhaseKnowledge, "only", 30);
    const at120 = estimateRemaining(singlePhaseKnowledge, "only", 120);
    const at1000 = estimateRemaining(singlePhaseKnowledge, "only", 1000);
    expect(at30.p50).toBeGreaterThan(0);
    expect(at120.p50).toBeGreaterThan(at30.p50);
    expect(at1000.p50).toBeGreaterThan(at120.p50);
    expect(at1000.p80).toBeGreaterThan(at1000.p50);
    expect(Number.isFinite(at1000.p80)).toBe(true);
  });

  it("経過が極端に長くても有限の値を返す", () => {
    const result = estimateRemaining(singlePhaseKnowledge, "only", 1_000_000);
    expect(Number.isFinite(result.p50)).toBe(true);
    expect(Number.isFinite(result.p80)).toBe(true);
    expect(result.p50).toBeGreaterThan(0);
  });

  it("p50 が 0 で p80 が正の段階も扱える", () => {
    const { p50, p80 } = estimateRemaining(zeroMedianKnowledge, "only", 0);
    expect(p50).toBeLessThanOrEqual(1);
    expect(Math.abs(p80 - 10)).toBeLessThanOrEqual(1);
  });

  it("経過時間が負または有限でないなら例外", () => {
    expect(() => estimateRemaining(lognormalKnowledge, "initial", -1)).toThrow(RangeError);
    expect(() => estimateRemaining(lognormalKnowledge, "initial", Number.NaN)).toThrow(RangeError);
    expect(() =>
      estimateRemaining(lognormalKnowledge, "initial", Number.POSITIVE_INFINITY),
    ).toThrow(RangeError);
  });

  it("未知の段階 ID なら例外", () => {
    expect(() => estimateRemaining(lognormalKnowledge, "unknown", 0)).toThrow(RangeError);
  });
});
