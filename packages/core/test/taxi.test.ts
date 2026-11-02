import { describe, expect, it } from "vitest";
import {
  OSAKA_CITY_TAXI_FARE,
  OSAKA_CITY_TAXI_FARE_SOURCES,
  TAXI_AVERAGE_SPEED_KMH,
  TAXI_DETOUR_FACTOR,
} from "../params/taxi.ts";
import {
  applyDistanceShortening,
  checkNightSurcharge,
  computeDistanceFare,
  computeTaxiFare,
  computeTaxiMinutes,
  estimateTaxiRoadKm,
} from "../src/taxi.ts";

describe("タクシーの所要時間", () => {
  it("道のりは直線距離 × 迂回係数", () => {
    expect(estimateTaxiRoadKm(10)).toBeCloseTo(10 * TAXI_DETOUR_FACTOR, 6);
  });

  it("所要時間は道のり ÷ 平均速度を切り上げる", () => {
    expect(computeTaxiMinutes(0)).toBe(0);
    expect(computeTaxiMinutes(TAXI_AVERAGE_SPEED_KMH)).toBe(60);
    expect(computeTaxiMinutes(0.1)).toBe(1);
  });

  it("負または有限でない距離は例外", () => {
    expect(() => computeTaxiMinutes(-1)).toThrow(RangeError);
    expect(() => estimateTaxiRoadKm(Number.NaN)).toThrow(RangeError);
  });
});

const DAY = "2026-11-05T12:00:00+09:00";
const NIGHT = "2026-11-05T23:30:00+09:00";

describe("computeTaxiFare（日中）", () => {
  it.each([
    [0, 600],
    [0.5, 600],
    [1.2, 600],
    [1.201, 700],
    [1.431, 700],
    [1.432, 800],
    [5, 2300],
    [20, 8800],
  ])("%d km は %d 円", (km, yen) => {
    expect(computeTaxiFare(km, DAY)).toMatchObject({ fareYen: yen, isNightSurcharge: false });
  });

  it("出典の説明を返す", () => {
    expect(computeTaxiFare(3, DAY).source).toContain("大阪市域交通圏");
  });

  it("負または有限でない距離は例外", () => {
    expect(() => computeTaxiFare(-0.1, DAY)).toThrow(RangeError);
    expect(() => computeTaxiFare(Number.NaN, DAY)).toThrow(RangeError);
  });
});

describe("computeTaxiFare（深夜早朝割増）", () => {
  // 割増時の初乗 1000 m・加算 193 m は公示の距離短縮方式から計算した推定値（割増後の距離そのものは未確認）
  it.each([
    [0, 600],
    [1.0, 600],
    [1.001, 700],
    [1.193, 700],
    [1.194, 800],
    [5, 2700],
    [20, 10_500],
  ])("%d km は %d 円", (km, yen) => {
    expect(computeTaxiFare(km, NIGHT)).toMatchObject({ fareYen: yen, isNightSurcharge: true });
  });

  it("長距離ではおよそ 2 割高い", () => {
    const ratio = computeTaxiFare(30, NIGHT).fareYen / computeTaxiFare(30, DAY).fareYen;
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.25);
  });
});

describe("checkNightSurcharge", () => {
  it.each([
    ["21:59:59", false],
    ["22:00:00", true],
    ["23:59:00", true],
    ["00:00:00", true],
    ["04:59:00", true],
    ["05:00:00", false],
    ["12:00:00", false],
  ])("%s は %s", (time, expected) => {
    expect(checkNightSurcharge(`2026-11-05T${time}+09:00`)).toBe(expected);
  });

  it("UTC の入力も日本時間で判定する", () => {
    // 13:30Z = 22:30 JST、20:00Z = 翌 05:00 JST
    expect(checkNightSurcharge("2026-11-05T13:30:00Z")).toBe(true);
    expect(checkNightSurcharge("2026-11-05T20:00:00Z")).toBe(false);
  });
});

describe("距離制運賃の部品", () => {
  it("距離短縮方式は距離を 1.2 で割り 1 m 単位に四捨五入する（1000 m・193 m は推定値）", () => {
    const night = applyDistanceShortening(OSAKA_CITY_TAXI_FARE, 0.2);
    expect(night.initialDistanceMeters).toBe(1000);
    expect(night.additionalDistanceMeters).toBe(193);
    expect(night.initialFareYen).toBe(600);
    expect(night.additionalFareYen).toBe(100);
  });

  it("初乗距離ちょうどは初乗運賃", () => {
    expect(computeDistanceFare(1200, OSAKA_CITY_TAXI_FARE)).toBe(600);
    expect(computeDistanceFare(1201, OSAKA_CITY_TAXI_FARE)).toBe(700);
  });
});

describe("運賃の出典", () => {
  it("一次情報の URL と確認日を持つ", () => {
    expect(OSAKA_CITY_TAXI_FARE_SOURCES.length).toBeGreaterThan(0);
    for (const source of OSAKA_CITY_TAXI_FARE_SOURCES) {
      expect(source.url).toMatch(/^https:\/\/wwwtb\.mlit\.go\.jp\/kinki\//);
      expect(source.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
