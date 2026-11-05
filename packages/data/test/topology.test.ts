import { describe, expect, it } from "vitest";
import type { Coord } from "../src/geometry.ts";
import { buildSegments } from "../src/segments.ts";
import { findAdjacentStations, removeBypassEdges } from "../src/topology.ts";

// 経度0.01度 ≒ 0.91km（北緯35度）の直線上に駅を置いた架空の路線
const LAT = 35;
const at = (lon: number): Coord => [lon, LAT];
const station = (code: string, lon: number) => ({ code, features: [[at(lon), at(lon + 0.002)]] });

describe("findAdjacentStations", () => {
  it("一本道の路線で隣どうしだけを結ぶ", () => {
    const sections: Coord[][] = [
      [at(0), at(0.002)],
      [at(0.002), at(0.01)],
      [at(0.01), at(0.012)],
      [at(0.012), at(0.02)],
      [at(0.02), at(0.022)],
    ];
    const stations = [station("A", 0), station("B", 0.01), station("C", 0.02)];
    const edges = findAdjacentStations(sections, stations);
    const pairs = edges.map((e) => `${e.a}-${e.b}`).sort();
    expect(pairs).toEqual(["A-B", "B-C"]);
    // 中心どうしの距離は 0.01度 ≒ 0.91km
    expect(edges[0]?.distanceKm).toBeCloseTo(0.912, 2);
  });

  it("駅間の分岐点を越えて枝線の駅とも結ぶ", () => {
    const sections: Coord[][] = [
      [at(0.002), at(0.006)],
      [at(0.006), at(0.01)],
      [at(0.006), [0.006, LAT + 0.01]],
    ];
    const branch = {
      code: "D",
      features: [
        [
          [0.006, LAT + 0.01],
          [0.006, LAT + 0.012],
        ] as Coord[],
      ],
    };
    const edges = findAdjacentStations(sections, [station("A", 0), station("B", 0.01), branch]);
    expect(edges.map((e) => `${e.a}-${e.b}`).sort()).toEqual(["A-B", "A-D", "B-D"]);
  });
});

describe("removeBypassEdges", () => {
  it("中間駅を通り越す辺を除く", () => {
    const edges = removeBypassEdges([
      { a: "A", b: "B", distanceKm: 1 },
      { a: "B", b: "C", distanceKm: 1 },
      { a: "A", b: "C", distanceKm: 2 },
    ]);
    expect(edges.map((e) => `${e.a}-${e.b}`)).toEqual(["A-B", "B-C"]);
  });
});

describe("buildSegments", () => {
  const rank = (id: string) => id.charCodeAt(0);

  it("一本道は基準に近い端から並べ、累積距離を持つ", () => {
    const { segments, issues } = buildSegments(
      ["C", "A", "B"],
      [
        { a: "B", b: "C", distanceKm: 2 },
        { a: "A", b: "B", distanceKm: 1.5 },
      ],
      rank,
    );
    expect(issues).toEqual([]);
    expect(segments).toEqual([
      { stationIds: ["A", "B", "C"], cumulativeKm: [0, 1.5, 3.5], loop: false, lengthKm: 3.5 },
    ]);
  });

  it("環状線はひと回りの区間にする", () => {
    const { segments } = buildSegments(
      ["A", "B", "C", "D"],
      [
        { a: "A", b: "B", distanceKm: 1 },
        { a: "B", b: "C", distanceKm: 1 },
        { a: "C", b: "D", distanceKm: 1 },
        { a: "A", b: "D", distanceKm: 1 },
      ],
      rank,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.loop).toBe(true);
    expect(segments[0]?.stationIds).toEqual(["A", "B", "C", "D"]);
    expect(segments[0]?.lengthKm).toBe(4);
  });

  it("分岐は分岐駅で区間を分け、注意として返す", () => {
    const { segments, issues } = buildSegments(
      ["A", "B", "C", "D"],
      [
        { a: "A", b: "B", distanceKm: 1 },
        { a: "B", b: "C", distanceKm: 1 },
        { a: "B", b: "D", distanceKm: 1 },
      ],
      rank,
    );
    expect(segments.map((s) => s.stationIds.join(""))).toEqual(["AB", "BC", "BD"]);
    expect(issues[0]).toContain("分岐駅");
  });
});
