import { describe, expect, it } from "vitest";
import {
  computeDepartedProbability,
  computeDepartureChance,
  decideInCarPlan,
  sampleDepartureMinutes,
} from "./departure-chance.ts";

// 駅間の車内の人の、時刻ごとの動き出している見込み

const now = "2026-11-08T20:00:00+09:00";
const departure = { p50: "2026-11-08T20:30:00+09:00", p80: "2026-11-08T20:50:00+09:00" };

describe("動き出すまでの標本", () => {
  it("動くのは の時刻でおよそ 5 割、遅い側の時刻でおよそ 8 割になる", () => {
    const samples = sampleDepartureMinutes(now, departure);
    expect(computeDepartedProbability(now, samples, departure.p50)).toBeCloseTo(0.5, 1);
    expect(computeDepartedProbability(now, samples, departure.p80)).toBeCloseTo(0.8, 1);
  });

  it("早い側と遅い側が同じなら、その時刻に一度に動き出す", () => {
    const samples = sampleDepartureMinutes(now, { p50: departure.p50, p80: departure.p50 });
    expect(computeDepartedProbability(now, samples, "2026-11-08T20:29:00+09:00")).toBe(0);
    expect(computeDepartedProbability(now, samples, departure.p50)).toBe(1);
  });
});

describe("動き出している見込み", () => {
  it("目盛りは時刻の順に並び、確率は下がらない", () => {
    const chance = computeDepartureChance({ now, departure, mark: null, onsetTime: null });
    if (!chance) throw new Error("見込みが出ない");
    expect(chance.ticks.length).toBeGreaterThanOrEqual(4);
    expect(chance.ticks.length).toBeLessThanOrEqual(6);
    const tenths = chance.ticks.map((t) => t.tenths);
    expect([...tenths].sort((a, b) => a - b)).toEqual(tenths);
    expect(chance.mark).toBeNull();
  });

  it("着く時刻の印には、その時刻までに動き出している確率を 1 割単位で付ける", () => {
    const chance = computeDepartureChance({
      now,
      departure,
      mark: { time: "2026-11-08T20:34:00+09:00", station: "大阪" },
      onsetTime: "2026-11-08T19:50:00+09:00",
    });
    if (!chance) throw new Error("見込みが出ない");
    expect(chance.mark?.station).toBe("大阪");
    expect(chance.mark?.tenths).toBeGreaterThanOrEqual(5);
    expect(chance.mark?.tenths).toBeLessThanOrEqual(7);
    expect(chance.ticks[0]?.sinceOnsetMinutes).toBeGreaterThan(10);
  });
});

describe("最初の目盛りで 10 割の場面", () => {
  it("動き出すのがいまなら、グラフの値を返さない", () => {
    const immediate = { p50: now, p80: now };
    expect(
      computeDepartureChance({ now, departure: immediate, mark: null, onsetTime: null }),
    ).toBeNull();
  });

  it("遅い側が最初の目盛りより前なら、返さない", () => {
    const early = { p50: "2026-11-08T20:03:00+09:00", p80: "2026-11-08T20:05:00+09:00" };
    expect(
      computeDepartureChance({ now, departure: early, mark: null, onsetTime: null }),
    ).toBeNull();
  });
});

describe("車内の人に勧める動き", () => {
  const guide = { alightStation: "天満", afterAlight: null, departure: departure.p50 };

  it("次の一手が無く、行き先が次の駅でなければ、乗り続ける", () => {
    expect(decideInCarPlan(guide, { kind: "station", name: "西九条" })).toBe("stay");
  });

  it("次の駅が行き先なら、そこで降りる", () => {
    expect(decideInCarPlan(guide, { kind: "station", name: "天満" })).toBe("alight");
  });

  it("動き出す見込みが無ければ、どちらとも決めない", () => {
    expect(
      decideInCarPlan({ ...guide, departure: null }, { kind: "station", name: "西九条" }),
    ).toBe("unknown");
  });
});
