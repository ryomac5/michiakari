import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  computeDistanceMeters,
  createGeoIndex,
  isPointInGeometry,
  type NetworkData,
} from "@repo/geo";
import network from "@repo/geo/data/network.json";
import { loadIsochrones } from "@repo/geo/node";
import type { RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { buildPersonAccidentEvents } from "@/features/judgment/fixtures/person-accident";
import { buildTestRequest } from "@/features/judgment/test-helpers";
import { createMapGeo, type LinesGeoJson } from "./geo-data";
import { findReachAreas, type ReachArea } from "./reach";
import {
  buildBlockedSectionPath,
  buildCirclePolygon,
  buildKeyStations,
  buildMapScene,
  buildReachFeatures,
  buildStationLabels,
  computeFitBounds,
  computeWalkReachMeters,
  findLinesByName,
  findStationPathOnLine,
  type LegStationRefs,
  listReachableStations,
  listTransferServiceLineIds,
  type Position,
  resolvePlacePosition,
  resolveRouteLegs,
  resolveStationByName,
  thinKeyStationsOnScreen,
  translateLineName,
} from "./scene";

const geo = createMapGeo(network as unknown as NetworkData);
// 地図で路線を描く線路の形も読んだ網。止まっている区間はこの形から切り出す
const lines = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@repo/geo/data/lines.geojson"), "utf8"),
) as LinesGeoJson;
const trackGeo = createMapGeo(network as unknown as NetworkData, lines);
const labels = { origin: "現在地", destination: "行き先", blocked: "見合わせ" };

// 点から線路の形までの距離。切り出した線が線路の上にあるかを確かめるのに使う
function measureTrackMeters(p: Position, lineId: string): number {
  const feature = lines.features.find((f) => f.properties.lineId === lineId);
  const parts =
    feature?.geometry.type === "LineString"
      ? [feature.geometry.coordinates]
      : (feature?.geometry.coordinates ?? []);
  let best = Number.POSITIVE_INFINITY;
  for (const part of parts) {
    for (let i = 1; i < part.length; i++) {
      const a = part[i - 1] as Position;
      const b = part[i] as Position;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = dx * dx + dy * dy;
      const t =
        length === 0
          ? 0
          : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
      best = Math.min(best, computeDistanceMeters(p, [a[0] + dx * t, a[1] + dy * t]));
    }
  }
  return best;
}

// 線路の形の頂点の集合。切り出した線の途中の点が、すべて線路の頂点かを確かめるのに使う
function listTrackVertexKeys(lineId: string): Set<string> {
  const feature = lines.features.find((f) => f.properties.lineId === lineId);
  const parts =
    feature?.geometry.type === "LineString"
      ? [feature.geometry.coordinates]
      : (feature?.geometry.coordinates ?? []);
  return new Set(parts.flat().map((p) => `${p[0]},${p[1]}`));
}

// 環状線と枝分かれを含む小さな架空の路線網
const toyNetwork: NetworkData = {
  version: 1,
  generatedAt: "2026-11-02T00:00:00.000Z",
  nodes: ["a", "b", "c", "d", "e"].map((id, i) => ({
    stationId: `loop.${id}`,
    name: id.toUpperCase(),
    operator: "架空鉄道",
    lineId: "loop",
    lonLat: [135 + i * 0.01, 34.7] as const,
    passengers: 1000 * (i + 1),
  })),
  lines: [
    {
      lineId: "loop",
      operator: "架空鉄道",
      operatorKey: "toy",
      lineName: "環状線",
      aliases: [],
      lineType: "jr_local",
      color: "#ff0000",
      segments: [
        {
          stationIds: ["loop.a", "loop.b", "loop.c", "loop.d", "loop.e"],
          cumulativeKm: [0, 1, 2, 3, 4],
          loop: true,
          lengthKm: 5,
        },
      ],
    },
  ],
  edges: [
    ["a", "b"],
    ["b", "c"],
    ["c", "d"],
    ["d", "e"],
    ["e", "a"],
  ].map(([from, to]) => ({
    from: `loop.${from}`,
    to: `loop.${to}`,
    lineId: "loop",
    lineType: "jr_local" as const,
    distanceKm: 1,
  })),
  transfers: [],
};

function buildOption(overrides: Partial<RouteOption>): RouteOption {
  return {
    id: "option",
    kind: "transfer",
    label: "",
    legs: [],
    arrivalTime: "2026-11-02T23:00:00+09:00",
    fareYen: null,
    walkMinutes: 0,
    isTransferService: false,
    ...overrides,
  };
}

const hankyuTransfer = buildOption({
  id: "transfer_hankyu",
  isTransferService: true,
  legs: [
    { mode: "walk", from: "大阪", to: "大阪梅田", minutes: 8 },
    { mode: "wait", from: "大阪梅田", to: "大阪梅田", minutes: 4 },
    { mode: "ride", from: "大阪梅田", to: "神戸三宮", minutes: 27, line: "阪急神戸線" },
    { mode: "walk", from: "神戸三宮", to: "三ノ宮", minutes: 3 },
  ],
});

const waitResume = buildOption({
  id: "wait_resume",
  kind: "wait",
  legs: [
    { mode: "wait", from: "大阪", to: "大阪", minutes: 10 },
    { mode: "ride", from: "大阪", to: "三ノ宮", minutes: 22, line: "JR神戸線" },
  ],
});

describe("findLinesByName", () => {
  it("別名と、事業者名＋路線名の両方で引ける", () => {
    expect(findLinesByName(geo.index, "JR神戸線").map((l) => l.lineId)).toContain(
      "jr-west.東海道線",
    );
    expect(findLinesByName(geo.index, "阪急神戸線").map((l) => l.lineId)).toEqual([
      "hankyu.神戸線",
    ]);
    expect(findLinesByName(geo.index, "存在しない線")).toEqual([]);
    expect(findLinesByName(geo.index, null)).toEqual([]);
  });
});

describe("resolveStationByName", () => {
  it("路線の指定に合う駅を優先する", () => {
    expect(resolveStationByName(geo.index, "大阪梅田", ["hanshin.本線"])?.stationId).toBe(
      "hanshin.本線.大阪梅田",
    );
  });

  it("指定が無ければ表記が同じで乗降客数の多い駅を選ぶ", () => {
    expect(resolveStationByName(geo.index, "三ノ宮")?.stationId).toBe("jr-west.東海道線.三ノ宮");
    expect(resolveStationByName(geo.index, "どこにもない駅")).toBeUndefined();
  });
});

describe("findStationPathOnLine", () => {
  const toy = createMapGeo(toyNetwork);

  it("環状線では短い向きの駅の並びを返す", () => {
    expect(findStationPathOnLine(toy.graph, "loop", "loop.a", "loop.d")).toEqual([
      "loop.a",
      "loop.e",
      "loop.d",
    ]);
    expect(findStationPathOnLine(toy.graph, "loop", "loop.b", "loop.d")).toEqual([
      "loop.b",
      "loop.c",
      "loop.d",
    ]);
  });

  it("別の路線の駅にはたどり着けない", () => {
    expect(findStationPathOnLine(toy.graph, "other", "loop.a", "loop.b")).toBeNull();
  });
});

describe("buildBlockedSectionPath", () => {
  it("路線名と 2 駅から、途中の駅を通る折れ線を作る", () => {
    const path = buildBlockedSectionPath(geo, { fromStation: "大阪", toStation: "三ノ宮" }, [
      "JR神戸線",
    ]);
    expect(path?.lineId).toBe("jr-west.東海道線");
    const coords = path?.coordinates ?? [];
    // 大阪〜三ノ宮には途中駅が 10 以上ある
    expect(coords.length).toBeGreaterThan(10);
    const osaka = geo.index.getStation("jr-west.東海道線.大阪")?.lonLat;
    const sannomiya = geo.index.getStation("jr-west.東海道線.三ノ宮")?.lonLat;
    expect(coords[0]).toEqual(osaka);
    expect(coords.at(-1)).toEqual(sannomiya);
  });

  it("路線名が無くても 2 駅を結ぶ路線から作る", () => {
    const path = buildBlockedSectionPath(geo, { fromStation: "大阪", toStation: "三ノ宮" }, []);
    expect(path?.lineId).toMatch(/^jr-west\./);
    expect(path?.coordinates.length ?? 0).toBeGreaterThan(2);
  });

  it("線路の形があれば、駅を結ぶ直線ではなく線路の頂点を通る線にする", () => {
    const path = buildBlockedSectionPath(trackGeo, { fromStation: "大阪", toStation: "三ノ宮" }, [
      "JR神戸線",
    ]);
    const byStations = buildBlockedSectionPath(geo, { fromStation: "大阪", toStation: "三ノ宮" }, [
      "JR神戸線",
    ]);
    expect(path?.lineId).toBe("jr-west.東海道線");
    const coords = path?.coordinates ?? [];
    // 線路の形は駅の並びより細かい
    expect(coords.length).toBeGreaterThan(byStations?.coordinates.length ?? 0);
    const vertices = listTrackVertexKeys("jr-west.東海道線");
    for (const p of coords) expect(measureTrackMeters(p, "jr-west.東海道線")).toBeLessThan(1);
    expect(coords.filter((p) => vertices.has(`${p[0]},${p[1]}`)).length).toBeGreaterThan(20);
    // 両端は駅の近くの線路の上
    const osaka = geo.index.getStation("jr-west.東海道線.大阪")?.lonLat as Position;
    const sannomiya = geo.index.getStation("jr-west.東海道線.三ノ宮")?.lonLat as Position;
    expect(computeDistanceMeters(coords[0] as Position, osaka)).toBeLessThan(300);
    expect(computeDistanceMeters(coords.at(-1) as Position, sannomiya)).toBeLessThan(300);
  });

  it("駅が引けなければ null", () => {
    expect(
      buildBlockedSectionPath(geo, { fromStation: "架空駅", toStation: "三ノ宮" }, ["JR神戸線"]),
    ).toBeNull();
  });
});

describe("buildBlockedSectionPath の環状線", () => {
  // 輪の上の 5 駅。駅のつながりでは A→B→C が短いが、線路の形では A→E→D→C の側が短い
  const positions: Record<string, Position> = {
    a: [135.0, 34.7],
    b: [135.01, 34.71],
    c: [135.02, 34.7],
    d: [135.015, 34.695],
    e: [135.005, 34.695],
  };
  const ring: NetworkData = {
    ...toyNetwork,
    nodes: toyNetwork.nodes.map((n) => ({
      ...n,
      lonLat: positions[n.stationId.slice("loop.".length)] as [number, number],
    })),
    edges: toyNetwork.edges.map((e) => ({
      ...e,
      // B を通る側を、駅のつながりでは短くする
      distanceKm: e.from === "loop.a" || e.from === "loop.b" ? 1 : 5,
    })),
  };
  // A から B は北へ回る線路。ほかは駅を直に結ぶ
  const north: Position[] = [positions.a as Position, [135.0, 34.72], positions.b as Position];
  const rest: Position[] = [
    positions.b as Position,
    positions.c as Position,
    positions.d as Position,
    positions.e as Position,
    positions.a as Position,
  ];
  const ringGeo = {
    ...createMapGeo(ring),
    trackShapes: new Map([["loop", [north, rest]]]),
  };

  it("駅の並びが通る側の線路を、駅の間ごとに切り出してつなぐ", () => {
    expect(findStationPathOnLine(ringGeo.graph, "loop", "loop.a", "loop.c")).toEqual([
      "loop.a",
      "loop.b",
      "loop.c",
    ]);
    const path = buildBlockedSectionPath(ringGeo, { fromStation: "A", toStation: "C" }, ["環状線"]);
    const coords = path?.coordinates ?? [];
    // 北へ回る線路を通り、反対側の D と E は通らない
    expect(coords).toContainEqual([135.0, 34.72]);
    expect(coords).toContainEqual(positions.b);
    expect(coords).not.toContainEqual(positions.d);
    expect(coords).not.toContainEqual(positions.e);
    expect(coords[0]).toEqual(positions.a);
    expect(coords.at(-1)).toEqual(positions.c);
  });
});

describe("resolveRouteLegs", () => {
  it("駅名から、徒歩は直線・乗車は路線に沿った折れ線にする。待ちは描かない", () => {
    const legs = resolveRouteLegs(geo, hankyuTransfer);
    expect(legs.map((l) => l.mode)).toEqual(["walk", "ride", "walk"]);
    expect(legs[0]?.coordinates).toHaveLength(2);
    expect(legs[1]?.lineId).toBe("hankyu.神戸線");
    expect(legs[1]?.coordinates.length ?? 0).toBeGreaterThan(5);
  });

  it("駅 ID があれば駅名より優先する", () => {
    const leg: RouteOption["legs"][number] & LegStationRefs = {
      mode: "ride",
      from: "表記ゆれ",
      to: "表記ゆれ",
      minutes: 10,
      fromStationId: "hanshin.本線.大阪梅田",
      toStationId: "hanshin.本線.神戸三宮",
      lineId: "hanshin.本線",
    };
    const legs = resolveRouteLegs(geo, buildOption({ legs: [leg] }));
    expect(legs[0]?.lineId).toBe("hanshin.本線");
    expect(legs[0]?.coordinates[0]).toEqual(geo.index.getStation("hanshin.本線.大阪梅田")?.lonLat);
  });

  it("引けない地点への区間は飛ばし、次の区間は直前の駅から描く", () => {
    const legs = resolveRouteLegs(
      geo,
      buildOption({
        legs: [
          { mode: "walk", from: "大阪", to: "大阪駅タクシー乗り場", minutes: 3 },
          { mode: "taxi", from: "大阪駅タクシー乗り場", to: "三ノ宮", minutes: 45 },
        ],
      }),
    );
    expect(legs.map((l) => l.mode)).toEqual(["taxi"]);
    expect(legs[0]?.coordinates[0]).toEqual(resolveStationByName(geo.index, "大阪")?.lonLat);
  });

  it("出発地点が最初から引けなければ、その区間は描かない", () => {
    const legs = resolveRouteLegs(
      geo,
      buildOption({ legs: [{ mode: "taxi", from: "乗り場", to: "三ノ宮", minutes: 30 }] }),
    );
    expect(legs).toEqual([]);
  });
});

describe("listTransferServiceLineIds", () => {
  it("振替輸送の経路が乗る路線だけを返す", () => {
    expect(listTransferServiceLineIds(geo, [waitResume, hankyuTransfer])).toEqual([
      "hankyu.神戸線",
    ]);
  });
});

describe("到達範囲", () => {
  it("半径は 徒歩分 × 80m ÷ 1.3", () => {
    expect(computeWalkReachMeters(13)).toBeCloseTo(800);
  });

  it("円の頂点はどれも中心から半径の距離にあり、閉じている", () => {
    const center: Position = [135.4959, 34.7025];
    const ring = buildCirclePolygon(center, 1000, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring.at(-1));
    for (const p of ring) expect(computeDistanceMeters(center, p)).toBeCloseTo(1000, -1);
  });

  it("範囲内の駅のうち、止まっている路線の駅を除く", () => {
    const osaka = geo.index.getStation("jr-west.東海道線.大阪")?.lonLat as Position;
    const circle = { type: "Polygon" as const, coordinates: [buildCirclePolygon(osaka, 1000)] };
    const reachable = listReachableStations(geo.nodes, circle, ["jr-west.東海道線"]);
    const ids = reachable.map((n) => n.stationId);
    expect(ids).toContain("hankyu.神戸線.大阪梅田");
    expect(ids).toContain("osaka-metro.御堂筋線.梅田");
    expect(ids).not.toContain("jr-west.東海道線.大阪");
    expect(ids).not.toContain("jr-west.東海道線.三ノ宮");
  });

  it("駅の抽出は距離ではなく多角形の内外で決める", () => {
    const osaka = geo.index.getStation("jr-west.東海道線.大阪")?.lonLat as Position;
    // 大阪駅から東へ延びる細長い帯。帯の外にある近くの駅は入らない
    const [lon, lat] = osaka;
    const strip = {
      type: "Polygon" as const,
      coordinates: [
        [
          [lon - 0.001, lat - 0.0005],
          [lon + 0.02, lat - 0.0005],
          [lon + 0.02, lat + 0.0005],
          [lon - 0.001, lat + 0.0005],
          [lon - 0.001, lat - 0.0005],
        ] as Position[],
      ],
    };
    const reachable = listReachableStations(geo.nodes, strip, []);
    expect(reachable.map((n) => n.stationId)).toContain("jr-west.東海道線.大阪");
    for (const n of reachable) expect(isPointInGeometry(n.lonLat, strip)).toBe(true);
    const nearButOutside = geo.nodes.filter(
      (n) => computeDistanceMeters(osaka, n.lonLat) <= 1000 && !isPointInGeometry(n.lonLat, strip),
    );
    expect(nearButOutside.length).toBeGreaterThan(0);
    const ids = new Set(reachable.map((n) => n.stationId));
    for (const n of nearButOutside) expect(ids.has(n.stationId)).toBe(false);
  });
});

describe("buildReachFeatures", () => {
  const center: Position = [135.5, 34.7];
  const square = (size: number): ReachArea["geometry"] => ({
    type: "Polygon",
    coordinates: [
      [
        [135.5 - size, 34.7 - size],
        [135.5 + size, 34.7 - size],
        [135.5 + size, 34.7 + size],
        [135.5 - size, 34.7 + size],
        [135.5 - size, 34.7 - size],
      ],
    ],
  });

  it("10 分と 20 分がそろえば事前計算の範囲を広い順に使う", () => {
    const areas = [
      { minutes: 10, geometry: square(0.005) },
      { minutes: 20, geometry: square(0.01) },
    ];
    const reach = buildReachFeatures(center, areas);
    expect(reach.source).toBe("valhalla");
    expect(reach.features.map((f) => f.properties.minutes)).toEqual([20, 10]);
    expect(reach.features[0]?.geometry).toEqual(square(0.01));
  });

  it("範囲が無いか片方だけなら円で概算する", () => {
    for (const areas of [[], [{ minutes: 10, geometry: square(0.005) }]]) {
      const reach = buildReachFeatures(center, areas);
      expect(reach.source).toBe("circle");
      expect(reach.features.map((f) => f.properties.minutes)).toEqual([20, 10]);
      expect(reach.features[1]?.geometry).toEqual({
        type: "Polygon",
        coordinates: [buildCirclePolygon(center, computeWalkReachMeters(10))],
      });
    }
  });
});

describe("findReachAreas", () => {
  const reachIndex = createGeoIndex(network as unknown as NetworkData, {
    isochrones: loadIsochrones(),
  });

  it("大阪は 10 分と 20 分の範囲を返し、駅はその内側にある", () => {
    const result = findReachAreas(reachIndex, "大阪");
    expect(result.areas.map((a) => a.minutes)).toEqual([10, 20]);
    const station = reachIndex.getStation(result.stationId as string);
    expect(station?.name).toBe("大阪");
    for (const area of result.areas) {
      expect(isPointInGeometry(station?.lonLat as Position, area.geometry)).toBe(true);
    }
  });

  it("範囲の無い駅と、引けない駅名は空を返す", () => {
    expect(findReachAreas(geo.index, "大阪")).toEqual({
      stationId: expect.any(String),
      areas: [],
    });
    expect(findReachAreas(reachIndex, "存在しない駅")).toEqual({ stationId: null, areas: [] });
  });
});

describe("buildStationLabels", () => {
  it("同じ名前で近い駅を 1 つにまとめ、強調する駅を最優先にする", () => {
    const emphasized = new Set(["hankyu.神戸線.大阪梅田"]);
    const features = buildStationLabels(geo.nodes, emphasized).features;
    const umeda = features.filter((f) => f.properties.name === "大阪梅田");
    expect(umeda.length).toBeLessThan(geo.nodes.filter((n) => n.name === "大阪梅田").length);
    const emphasizedLabel = umeda.find((f) => f.properties.emphasis);
    expect(emphasizedLabel).toBeDefined();
    const minKey = Math.min(...features.map((f) => f.properties.sortKey));
    expect(emphasizedLabel?.properties.sortKey).toBe(minKey);
  });

  it("阪急と阪神の大阪梅田のように、500m 以内の同名駅はラベルを 1 つにする", () => {
    const features = buildStationLabels(geo.nodes, new Set()).features;
    expect(features.filter((f) => f.properties.name === "大阪梅田")).toHaveLength(1);
    // 同じ名前のラベルどうしは 500m より離れている
    const byName = new Map<string, typeof features>();
    for (const f of features) {
      byName.set(f.properties.name, [...(byName.get(f.properties.name) ?? []), f]);
    }
    for (const group of byName.values()) {
      for (const [i, a] of group.entries()) {
        for (const b of group.slice(i + 1)) {
          const meters = computeDistanceMeters(
            a.geometry.coordinates as [number, number],
            b.geometry.coordinates as [number, number],
          );
          expect(meters, a.properties.name).toBeGreaterThan(500);
        }
      }
    }
  });

  it("格子の境目をまたぐ近い同名駅はまとめ、遠い同名駅は分けたままにする", () => {
    const node = (stationId: string, lon: number, passengers: number) => ({
      stationId,
      name: "架空",
      operator: "架空鉄道",
      lineId: stationId,
      lonLat: [lon, 34.7] as const,
      passengers,
    });
    // 135.0049 と 135.0051 は小数 2 桁で丸めると別の格子になる。約 20m
    const near = buildStationLabels(
      [node("a", 135.0049, 100), node("b", 135.0051, 200)],
      new Set(),
    ).features;
    expect(near).toHaveLength(1);
    expect(near[0]?.properties.passengers).toBe(200);
    // 約 1.8km 離れた同名駅
    const far = buildStationLabels(
      [node("a", 135.0, 100), node("b", 135.02, 200)],
      new Set(),
    ).features;
    expect(far).toHaveLength(2);
  });
});

describe("buildKeyStations", () => {
  const osaka: Position = [135.4959, 34.7025];
  const kyoto: Position = [135.7588, 34.9858];
  it("出発・行き先の近くの乗換駅と、近すぎる名前は出さない", () => {
    const labels = buildKeyStations([
      { position: osaka, name: "大阪", role: "origin" },
      { position: kyoto, name: "京都", role: "destination" },
      { position: [135.4985, 34.705], name: "梅田", role: "transfer" },
      { position: [135.5, 34.73], name: "西中島南方", role: "transfer" },
      { position: [135.5005, 34.7305], name: "南方", role: "transfer" },
      { position: null, name: "どこか", role: "blocked-end" },
    ]);
    expect(labels.features.map((f) => f.properties.name)).toEqual(["大阪", "京都", "西中島南方"]);
  });
});

describe("computeFitBounds", () => {
  it("全点を含む矩形を返し、点が無ければ null", () => {
    expect(
      computeFitBounds([
        [135.1, 34.6],
        [135.5, 34.8],
      ]),
    ).toEqual([
      [135.1, 34.6],
      [135.5, 34.8],
    ]);
    expect(computeFitBounds([])).toBeNull();
  });

  it("点が 1 つでも最小の幅を持たせる", () => {
    const bounds = computeFitBounds([[135.5, 34.7]], 0.02);
    expect(bounds?.[1][0]).toBeCloseTo(135.51);
    expect(bounds?.[0][1]).toBeCloseTo(34.69);
  });
});

describe("thinKeyStationsOnScreen", () => {
  const keyStations = buildKeyStations([
    { position: [135.0, 34.7], name: "塚本", role: "origin" },
    { position: [135.2, 34.7], name: "三ノ宮", role: "destination" },
    { position: [135.03, 34.7], name: "大阪", role: "blocked-end" },
  ]);
  // 経度 0.01 度を 10px とみなす画面
  const project = ([lon, lat]: Position) => ({ x: (lon - 135) * 1000, y: (34.7 - lat) * 1000 });

  it("画面で近い名前は、先に挙げた出発の名前だけを残す", () => {
    const thinned = thinKeyStationsOnScreen(keyStations, project);
    expect(thinned.features.map((f) => f.properties.name)).toEqual(["塚本", "三ノ宮"]);
  });

  it("寄せて画面で離れれば、区間の端の名前も出す", () => {
    const zoomed = ([lon, lat]: Position) => ({
      x: (lon - 135) * 10_000,
      y: (34.7 - lat) * 10_000,
    });
    const thinned = thinKeyStationsOnScreen(keyStations, zoomed);
    expect(thinned.features.map((f) => f.properties.name)).toEqual(["塚本", "三ノ宮", "大阪"]);
  });
});

describe("buildMapScene", () => {
  const input = {
    origin: { kind: "station" as const, name: "大阪" },
    destination: { kind: "station" as const, name: "三ノ宮" },
    options: [waitResume, hankyuTransfer],
    recommendedOptionId: "transfer_hankyu",
    blockedSection: { fromStation: "大阪", toStation: "三ノ宮" },
  };

  it("止まっている区間・到達範囲・推奨経路・振替対象・地名をまとめて作る", () => {
    const scene = buildMapScene(geo, input, labels);
    expect(scene.blockedLineIds).toEqual(["jr-west.東海道線"]);
    expect(scene.blocked.features[0]?.properties.label).toBe("見合わせ 大阪〜三ノ宮");
    expect(scene.reach.features.map((f) => f.properties.minutes)).toEqual([20, 10]);
    expect(scene.reachSource).toBe("circle");
    expect(scene.route.features.map((f) => f.properties.mode)).toEqual(["walk", "ride", "walk"]);
    expect(scene.transferLineIds).toEqual(["hankyu.神戸線"]);
    expect(scene.places.features.map((f) => f.properties.role)).toEqual(["origin", "destination"]);
    expect(
      scene.reachableStations.features.some((f) => f.properties.stationId.startsWith("hankyu.")),
    ).toBe(true);
  });

  it("選んだ経路を描き、推奨と止まっている区間は変えない", () => {
    const recommended = buildMapScene(geo, input, labels);
    const selected = buildMapScene(geo, { ...input, selectedOptionId: "wait_resume" }, labels);
    expect(selected.route.features).not.toEqual(recommended.route.features);
    expect(selected.route.features.map((f) => f.properties.label)).toEqual(["JR神戸線"]);
    expect(
      selected.alternatives.features.every((f) => f.properties.optionId !== "wait_resume"),
    ).toBe(true);
    expect(selected.blocked).toEqual(recommended.blocked);
    expect(selected.transferLineIds).toEqual(recommended.transferLineIds);
  });

  it("選んだ経路が無ければ推奨の経路を描く", () => {
    const recommended = buildMapScene(geo, input, labels);
    const unselected = buildMapScene(geo, { ...input, selectedOptionId: null }, labels);
    expect(unselected.route.features).toEqual(recommended.route.features);
  });

  it("到達範囲があれば多角形で描き、動いている駅は 20 分の範囲の内側だけにする", () => {
    const reachIndex = createGeoIndex(network as unknown as NetworkData, {
      isochrones: loadIsochrones(),
    });
    const { areas } = findReachAreas(reachIndex, "大阪");
    const scene = buildMapScene(geo, { ...input, reachAreas: areas }, labels);
    expect(scene.reachSource).toBe("valhalla");
    const widest = areas.find((a) => a.minutes === 20)?.geometry as ReachArea["geometry"];
    expect(scene.reach.features[0]?.geometry).toEqual(widest);
    expect(scene.reachableStations.features.length).toBeGreaterThan(0);
    for (const f of scene.reachableStations.features) {
      expect(isPointInGeometry(f.geometry.coordinates, widest)).toBe(true);
      expect(f.properties.stationId.startsWith("jr-west.東海道線.")).toBe(false);
    }
  });

  it("フィットする範囲は現在地・行き先・区間を含み、関西全域より狭い", () => {
    const scene = buildMapScene(geo, input, labels);
    const [[west, south], [east, north]] = scene.bounds as [Position, Position];
    for (const p of [scene.origin, scene.destination] as Position[]) {
      expect(p[0]).toBeGreaterThanOrEqual(west);
      expect(p[0]).toBeLessThanOrEqual(east);
      expect(p[1]).toBeGreaterThanOrEqual(south);
      expect(p[1]).toBeLessThanOrEqual(north);
    }
    expect(east - west).toBeLessThan(0.5);
  });

  it("推奨が無く、区間も無ければ経路と区間は空になる", () => {
    const scene = buildMapScene(
      geo,
      { ...input, recommendedOptionId: null, blockedSection: null },
      labels,
    );
    expect(scene.route.features).toEqual([]);
    expect(scene.blocked.features).toEqual([]);
    expect(scene.blockedLineIds).toEqual([]);
  });

  it("発表の区間があれば、線路の形に沿った線と「見合わせ 大阪〜三ノ宮」の札を描く", () => {
    const scene = buildMapScene(trackGeo, input, labels);
    const feature = scene.blocked.features[0];
    expect(feature?.properties.label).toBe("見合わせ 大阪〜三ノ宮");
    const vertices = listTrackVertexKeys("jr-west.東海道線");
    const coords = feature?.geometry.coordinates ?? [];
    expect(coords.length).toBeGreaterThan(20);
    for (const p of coords) expect(measureTrackMeters(p, "jr-west.東海道線")).toBeLessThan(1);
    expect(coords.filter((p) => vertices.has(`${p[0]},${p[1]}`)).length).toBeGreaterThan(20);
    expect(scene.keyStations.features.filter((f) => f.properties.role === "blocked-end")).toEqual(
      [],
    );
  });

  it("発表に区間が無ければ、入口の方面から区間を作らず、路線だけを止まっている路線として残す", () => {
    const tokaido = "jr-west.東海道線";
    const scene = buildMapScene(
      trackGeo,
      {
        ...input,
        blockedSection: null,
        blockedDirection: { lineId: tokaido, terminalId: `${tokaido}.神戸` },
      },
      labels,
    );
    expect(scene.blocked.features).toEqual([]);
    // 路線は薄く示し、代わりの手段の駅からは外す
    expect(scene.blockedLineIds).toEqual([tokaido]);
    expect(
      scene.reachableStations.features.some((f) =>
        f.properties.stationId.startsWith(`${tokaido}.`),
      ),
    ).toBe(false);
    // 区間の端の駅名も出さない
    expect(scene.keyStations.features.some((f) => f.properties.role === "blocked-end")).toBe(false);
    // 駅間の現在地を置く道筋は残し、線路の形に沿わせる。駅の並びの折れ線より点が多い
    expect(scene.trackLineIds).toEqual([tokaido]);
    const byStations = buildMapScene(
      geo,
      {
        ...input,
        blockedSection: null,
        blockedDirection: { lineId: tokaido, terminalId: `${tokaido}.神戸` },
      },
      labels,
    );
    expect(scene.trackPath?.length ?? 0).toBeGreaterThan(byStations.trackPath?.length ?? 0);
  });

  it("英語の札は駅の英語名で「Suspended Osaka–Sannomiya」にする", () => {
    const scene = buildMapScene(trackGeo, input, {
      ...labels,
      blocked: "Suspended",
      english: true,
    });
    expect(scene.blocked.features[0]?.properties.label).toBe("Suspended Osaka–Sannomiya");
  });

  it("モックの判断（駅 ID なし）でも、駅名から経路・区間・振替対象が地図に出る", () => {
    const ready = buildPersonAccidentEvents(buildTestRequest()).find(
      (e) => e.type === "judgment_ready",
    );
    if (ready?.type !== "judgment_ready") throw new Error("judgment_ready がありません");

    const scene = buildMapScene(
      geo,
      { ...input, options: ready.judgment.options, recommendedOptionId: "transfer_hankyu" },
      labels,
    );
    expect(scene.route.features.map((f) => f.properties.mode)).toEqual(["walk", "ride", "walk"]);
    expect(scene.blocked.features).toHaveLength(1);
    expect(scene.transferLineIds).toEqual(["hankyu.神戸線"]);
  });

  it("推奨経路は最も長い乗車区間にだけ路線名を付け、止まっている区間と並走する乗車区間は横へずらす", () => {
    const scene = buildMapScene(geo, input, labels);
    expect(scene.route.features.map((f) => f.properties.label)).toEqual(["", "阪急神戸線", ""]);
    const offsets = scene.route.features.map((f) => f.properties.offset);
    expect(offsets[0]).toBe(0);
    expect(Math.abs(offsets[1] ?? 0)).toBe(1);
  });

  it("その列車だけが止まる事象では、止まった区間の線と見合わせの札を描かず、線路の道筋だけを残す", () => {
    const section = buildMapScene(geo, input, labels);
    const train = buildMapScene(geo, { ...input, trainOnly: true }, labels);
    expect(train.blocked.features).toEqual([]);
    expect(train.blockedLineIds).toEqual([]);
    expect(train.keyStations.features.some((f) => f.properties.role === "blocked-end")).toBe(false);
    // 駅間の現在地を線路の上に置くための道筋は、区間を止める事象と同じ
    expect(train.trackLineIds).toEqual(section.blockedLineIds);
    expect(train.trackPath).toEqual(section.blocked.features[0]?.geometry.coordinates);
  });

  it("駅間の車内の人には徒歩の範囲を描かない", () => {
    const scene = buildMapScene(geo, { ...input, hideReach: true }, labels);
    expect(scene.reach.features).toEqual([]);
    expect(scene.reachSource).toBeNull();
  });

  it("止まっている区間と並走する代替経路は出さず、並走しない乗車区間だけを出す", () => {
    const scene = buildMapScene(geo, input, labels);
    // 待つ経路は止まっている JR 神戸線そのものなので出さない
    expect(scene.alternatives.features).toEqual([]);
    const noBlocked = buildMapScene(geo, { ...input, blockedSection: null }, labels);
    expect(noBlocked.alternatives.features.map((f) => f.properties.optionId)).toEqual([
      "wait_resume",
    ]);
    expect(noBlocked.alternatives.features.every((f) => f.properties.mode === "ride")).toBe(true);
  });

  it("英語では路線名と駅名を英語にし、英語名の無い通称や駅名は出さない", () => {
    const scene = buildMapScene(geo, input, { ...labels, english: true });
    expect(scene.route.features.map((f) => f.properties.label)).toEqual([
      "",
      "Hankyu Kobe Line",
      "",
    ]);
    expect(scene.keyStations.features.map((f) => f.properties.name).slice(0, 2)).toEqual([
      "Osaka",
      "Sannomiya",
    ]);
    expect(translateLineName(geo.index, "阪急京都線")).toBe("Hankyu Kyoto Line");
    expect(translateLineName(geo.index, "JR神戸線")).toBeNull();
    expect(translateLineName(geo.index, "JR Kobe Line")).toBe("JR Kobe Line");
  });

  it("名前を出す駅は出発・行き先・止まっている区間の端だけで、出発と行き先を先に置く", () => {
    const scene = buildMapScene(geo, input, labels);
    const roles = scene.keyStations.features.map((f) => f.properties.role);
    expect(roles.slice(0, 2)).toEqual(["origin", "destination"]);
    expect(scene.keyStations.features.map((f) => f.properties.name).slice(0, 2)).toEqual([
      "大阪",
      "三ノ宮",
    ]);
    expect(new Set(roles)).toEqual(new Set(["origin", "destination"]));
  });

  it("座標で与えた現在地はそのまま使う", () => {
    expect(resolvePlacePosition(geo.index, { kind: "coord", lon: 135.5, lat: 34.7 })).toEqual([
      135.5, 34.7,
    ]);
  });
});
