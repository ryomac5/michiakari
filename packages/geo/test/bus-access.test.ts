import { describe, expect, it } from "vitest";
import { type BusStop, listWalkAccessBusStops, parseBusStops } from "../src/index.ts";
import { loadBusStopMeta, loadBusStops } from "../src/node.ts";

const stop = (id: string, name: string, operator: string, lonLat: [number, number]): BusStop => ({
  id,
  name,
  operator,
  officialUrl: null,
  lonLat,
});

const origin: [number, number] = [135.5, 34.7];

describe("listWalkAccessBusStops", () => {
  // 緯度 0.001 度はおよそ 111m。徒歩の概算は直線の 1.3 倍を 80m/分で歩く
  const stops = [
    stop("a:1", "近い停留所", "架空バス", [135.5, 34.701]),
    stop("a:2", "近い停留所", "架空バス", [135.5, 34.7015]),
    stop("a:3", "中くらいの停留所", "架空バス", [135.5, 34.703]),
    stop("b:1", "近い停留所", "別の架空バス", [135.5, 34.702]),
    stop("a:4", "遠い停留所", "架空バス", [135.5, 34.72]),
  ];

  it("徒歩の短い順に上限の内側を返し、同じ名前と事業者は近いほうにまとめる", () => {
    const result = listWalkAccessBusStops({ stops, origin, maxWalkMinutes: 10, limit: 3 });
    expect(result.map((r) => r.stop.id)).toEqual(["a:1", "b:1", "a:3"]);
    expect(result.map((r) => r.walkMinutes)).toEqual([2, 4, 6]);
  });

  it("上限の分を超える停留所と limit を超える件数は返さない", () => {
    expect(listWalkAccessBusStops({ stops, origin, maxWalkMinutes: 3, limit: 3 })).toHaveLength(1);
    expect(listWalkAccessBusStops({ stops, origin, maxWalkMinutes: 10, limit: 1 })).toHaveLength(1);
  });
});

describe("parseBusStops", () => {
  it("事業者名で公式の案内を引き、無ければ null にする", () => {
    const parsed = parseBusStops(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { id: "x:1", name: "架空", operator: "架空バス" },
            geometry: { type: "Point", coordinates: [135.5, 34.7] },
          },
          {
            type: "Feature",
            properties: { id: "x:2", name: "架空", operator: "案内なしバス" },
            geometry: { type: "Point", coordinates: [135.5, 34.7] },
          },
        ],
      },
      [{ name: "架空バス", url: "https://example.com/" }],
    );
    expect(parsed.map((s) => s.officialUrl)).toEqual(["https://example.com/", null]);
  });
});

describe("生成したバス停のデータ", () => {
  it("出典と件数を持ち、大阪の駅の近くに停留所がある", () => {
    const meta = loadBusStopMeta();
    const stops = loadBusStops();
    expect(meta?.dataYear).toBe(2022);
    expect(meta?.source.license).toBe("CC BY 4.0");
    expect(stops).toHaveLength(meta?.counts.total ?? -1);
    // 大阪駅の付近
    const near = listWalkAccessBusStops({
      stops,
      origin: [135.4959, 34.7025],
      maxWalkMinutes: 10,
      limit: 3,
    });
    expect(near.length).toBeGreaterThan(0);
  });
});
