import type { GeoMeta, LonLat, NetworkData, StationNode } from "@repo/geo";
import { describe, expect, it } from "vitest";
import { WALK_ATTRIBUTION } from "../config/sources.ts";
import { roundIsochroneGeometry, selectIsochronePlaces } from "../src/isochrone-places.ts";
import { parseGeofabrikDate } from "../src/osm-source.ts";
import { carryOverWalkResults } from "../src/walk-merge.ts";
import { toWalkRouteResult } from "../src/walk-route.ts";

const node = (
  stationId: string,
  name: string,
  lonLat: LonLat,
  passengers: number | null,
): StationNode => ({
  stationId,
  name,
  operator: "test",
  lineId: stationId.split(".").slice(0, 2).join("."),
  lonLat,
  passengers,
});

describe("parseGeofabrikDate", () => {
  it("日付入りのファイル名から日付を読む", () => {
    expect(
      parseGeofabrikDate("https://download.geofabrik.de/asia/japan/kansai-261101.osm.pbf"),
    ).toBe("2026-11-01");
  });

  it("日付の無い名前は失敗する", () => {
    expect(() => parseGeofabrikDate("kansai-latest.osm.pbf")).toThrow();
  });
});

describe("selectIsochronePlaces", () => {
  const nodes = [
    node("a.l1.大阪", "大阪", [135.4959, 34.7025], 400_000),
    node("a.l2.大阪", "大阪", [135.4995, 34.7035], 400_000),
    node("b.l1.梅田", "梅田", [135.4975, 34.703], 400_000),
    node("c.l1.遠い駅", "遠い駅", [135.6, 34.8], 1_000),
    node("d.l1.小さい駅", "小さい駅", [135.7, 34.9], 10),
  ];

  it("近くの駅と、少し離れた同名の駅を 1 か所にまとめる", () => {
    const places = selectIsochronePlaces(nodes, 10);
    expect(places[0]?.stationIds).toEqual(["a.l1.大阪", "a.l2.大阪", "b.l1.梅田"]);
    expect(places[0]?.passengers).toBe(1_200_000);
    expect(places).toHaveLength(3);
  });

  it("乗降客数の多い順に上限まで返す", () => {
    expect(selectIsochronePlaces(nodes, 2).map((p) => p.stationName)).toEqual(["大阪", "遠い駅"]);
  });
});

describe("roundIsochroneGeometry", () => {
  it("座標を丸め、重なった点と潰れた環を除く", () => {
    const geometry = roundIsochroneGeometry(
      {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [135.000001, 34.000001],
              [135.000002, 34.000002],
              [135.001, 34],
              [135.001, 34.001],
              [135, 34],
            ],
          ],
          [
            [
              [136, 35],
              [136.000001, 35],
              [136, 35.000001],
              [136, 35],
            ],
          ],
        ],
      },
      5,
    );
    expect(geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [135, 34],
          [135.001, 34],
          [135.001, 34.001],
          [135, 34],
        ],
      ],
    });
  });
});

describe("carryOverWalkResults", () => {
  const meta = (walk?: GeoMeta["walk"]): GeoMeta => ({
    generatedAt: "2026-11-02T00:00:00.000Z",
    attribution: ["鉄道データ"],
    sources: [],
    notes: [],
    counts: { lines: 0, stations: 0, edges: 0, transfers: 2 },
    ...(walk ? { walk } : {}),
  });
  const network = (transfers: NetworkData["transfers"]): NetworkData => ({
    version: 1,
    generatedAt: "2026-11-02T00:00:00.000Z",
    nodes: [],
    lines: [],
    edges: [],
    transfers,
  });
  const walk: GeoMeta["walk"] = {
    computedAt: "2026-11-02T00:00:00.000Z",
    attribution: "© OpenStreetMap contributors",
    osm: { name: "OSM", url: "u", date: "2026-11-01", license: "ODbL 1.0" },
    valhalla: { version: "3.9.1", image: "i" },
    walkingSpeedKmh: 4.8,
    counts: { transfers: 2, transfersRouted: 2, isochronePlaces: 300 },
    notes: [],
  };

  it("同じ乗換の経路を引き継ぎ、直線距離が変わった乗換は引き継がない", () => {
    const previous = {
      network: network([
        { from: "a", to: "b", walkMeters: 100, walkMinutes: 3, walkMetersRoute: 200 },
        { from: "a", to: "c", walkMeters: 150, walkMinutes: 4, walkMetersRoute: 280 },
      ]),
      meta: meta(walk),
    };
    const next = {
      network: network([
        { from: "a", to: "b", walkMeters: 100 },
        { from: "a", to: "c", walkMeters: 170 },
      ]),
      meta: meta(),
    };
    const merged = carryOverWalkResults(previous, next);
    expect(merged.network.transfers).toEqual([
      { from: "a", to: "b", walkMeters: 100, walkMinutes: 3, walkMetersRoute: 200 },
      { from: "a", to: "c", walkMeters: 170 },
    ]);
    expect(merged.meta.walk?.counts.transfersRouted).toBe(1);
    expect(merged.meta.attribution).toContain(WALK_ATTRIBUTION);
  });

  it("前回に徒歩経路が無ければそのまま返す", () => {
    const next = { network: network([{ from: "a", to: "b", walkMeters: 100 }]), meta: meta() };
    expect(carryOverWalkResults(null, next)).toBe(next);
    expect(carryOverWalkResults({ ...next }, next)).toBe(next);
  });
});

describe("toWalkRouteResult", () => {
  it("所要秒を分に切り上げる", () => {
    expect(toWalkRouteResult(286, { seconds: 315, meters: 419 })).toEqual({
      walkMinutes: 6,
      walkMetersRoute: 419,
    });
  });

  it("直線より短い経路は直線距離にそろえる", () => {
    expect(toWalkRouteResult(250, { seconds: 30, meters: 40 })).toEqual({
      walkMinutes: 4,
      walkMetersRoute: 250,
    });
  });

  it("線路の反対側に寄せられた大回りの経路は採らない", () => {
    expect(toWalkRouteResult(66, { seconds: 654, meters: 872 })).toBeNull();
    expect(toWalkRouteResult(910, { seconds: 1213, meters: 1617 })).not.toBeNull();
  });
});
