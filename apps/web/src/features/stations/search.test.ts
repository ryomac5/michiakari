import { describe, expect, it } from "vitest";
import { formatDistance } from "./describe";
import { provisionalStations } from "./fixtures/stations";
import { findNearestStation, searchStations } from "./search";

describe("searchStations", () => {
  it("駅名・かな・カタカナ・英字で探せ、完全一致を先頭に並べる", () => {
    expect(searchStations(provisionalStations, "大阪")[0]?.id).toBe("osaka");
    expect(searchStations(provisionalStations, "さんのみや")[0]?.id).toBe("sannomiya");
    expect(searchStations(provisionalStations, "サンノミヤ")[0]?.id).toBe("sannomiya");
    expect(searchStations(provisionalStations, "kyoto")[0]?.id).toBe("kyoto");
  });

  it("空の入力では何も返さない", () => {
    expect(searchStations(provisionalStations, "  ")).toEqual([]);
  });

  it("件数を上限で切る", () => {
    expect(searchStations(provisionalStations, "お", 3)).toHaveLength(3);
  });
});

describe("provisionalStations", () => {
  it("id と駅名が重複せず、関西の範囲に収まる", () => {
    const ids = provisionalStations.map((s) => s.id);
    const names = provisionalStations.map((s) => s.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(provisionalStations.length).toBeGreaterThanOrEqual(40);
    for (const s of provisionalStations) {
      expect(s.lat).toBeGreaterThan(34);
      expect(s.lat).toBeLessThan(35.5);
      expect(s.lon).toBeGreaterThan(134.8);
      expect(s.lon).toBeLessThan(136.2);
    }
  });
});

describe("findNearestStation", () => {
  it("最も近い駅と距離を返す", () => {
    const nearest = findNearestStation(provisionalStations, { lat: 34.6947, lon: 135.1952 });
    expect(nearest?.station.id).toBe("sannomiya");
    expect(nearest?.meters).toBeLessThan(50);
  });
});

describe("formatDistance", () => {
  it("1km 未満は 50m 単位、以上は 0.1km 単位で表す", () => {
    expect(formatDistance(12)).toBe("50m");
    expect(formatDistance(320)).toBe("300m");
    expect(formatDistance(1530)).toBe("1.5km");
  });
});
