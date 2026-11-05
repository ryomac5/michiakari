import { describe, expect, it } from "vitest";
import { WALK_DETOUR_FACTOR, WALK_SPEED_M_PER_MIN } from "../params/walk.ts";
import {
  computeHaversineMeters,
  computeWalkMinutesFromMeters,
  computeWalkReachMeters,
  estimateWalkMinutes,
  type LonLat,
} from "../src/walk.ts";

describe("computeWalkMinutesFromMeters", () => {
  it("距離 ÷ 歩く速さを切り上げる", () => {
    expect(computeWalkMinutesFromMeters(0)).toBe(0);
    expect(computeWalkMinutesFromMeters(WALK_SPEED_M_PER_MIN)).toBe(1);
    expect(computeWalkMinutesFromMeters(WALK_SPEED_M_PER_MIN + 1)).toBe(2);
  });

  it("負または有限でない距離は例外", () => {
    expect(() => computeWalkMinutesFromMeters(-1)).toThrow(RangeError);
    expect(() => computeWalkMinutesFromMeters(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

const origin: LonLat = [135.5, 34.7];

describe("computeHaversineMeters", () => {
  it("同じ地点なら 0", () => {
    expect(computeHaversineMeters(origin, origin)).toBe(0);
  });

  it("緯度 1 度はおよそ 111.2 km", () => {
    expect(computeHaversineMeters([135.5, 34], [135.5, 35])).toBeCloseTo(111_195, -1);
  });

  it("向きによらず同じ距離", () => {
    const to: LonLat = [135.52, 34.68];
    expect(computeHaversineMeters(origin, to)).toBeCloseTo(computeHaversineMeters(to, origin), 6);
  });

  it("範囲外の座標は例外", () => {
    expect(() => computeHaversineMeters([181, 34], origin)).toThrow(RangeError);
    expect(() => computeHaversineMeters(origin, [135, -91])).toThrow(RangeError);
    expect(() => computeHaversineMeters([Number.NaN, 34], origin)).toThrow(RangeError);
  });
});

describe("estimateWalkMinutes", () => {
  it("同じ地点なら 0 分", () => {
    expect(estimateWalkMinutes(origin, origin)).toBe(0);
  });

  it("直線距離 × 迂回係数 ÷ 速さを切り上げる", () => {
    const to: LonLat = [135.5, 34.71];
    const meters = computeHaversineMeters(origin, to);
    expect(estimateWalkMinutes(origin, to)).toBe(
      Math.ceil((meters * WALK_DETOUR_FACTOR) / WALK_SPEED_M_PER_MIN),
    );
  });

  it("直線 1 km はおよそ 17 分", () => {
    // 緯度 0.008993 度 ≈ 1000 m、1000 × 1.3 ÷ 80 = 16.25
    expect(estimateWalkMinutes([135.5, 34.7], [135.5, 34.708993])).toBe(17);
  });

  it("ごく近い地点は 1 分", () => {
    expect(estimateWalkMinutes(origin, [135.5, 34.7001])).toBe(1);
  });
});

describe("computeWalkReachMeters", () => {
  it("上限の分で歩ける道のりを迂回係数で割る", () => {
    expect(computeWalkReachMeters(10)).toBeCloseTo(
      (10 * WALK_SPEED_M_PER_MIN) / WALK_DETOUR_FACTOR,
    );
  });

  it("届く距離の点は上限の分に収まる", () => {
    const meters = computeWalkReachMeters(10);
    const from: LonLat = [135.5, 34.7];
    // 緯度 1 度はおよそ 111km。少し内側の点で確かめる
    const to: LonLat = [135.5, 34.7 + (meters * 0.99) / 111_195];
    expect(estimateWalkMinutes(from, to)).toBeLessThanOrEqual(10);
  });

  it("負または有限でない分は例外", () => {
    expect(() => computeWalkReachMeters(-1)).toThrow(RangeError);
    expect(() => computeWalkReachMeters(Number.NaN)).toThrow(RangeError);
  });
});
