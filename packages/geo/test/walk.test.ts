import { describe, expect, it } from "vitest";
import {
  buildNetworkGraph,
  createGeoIndex,
  getTransferWalkMinutes,
  type IsochroneFeature,
  type LonLat,
  type NetworkData,
  type StationNode,
} from "../src/index.ts";
import { loadGeoIndex, loadGeoMeta, loadIsochrones, loadNetworkData } from "../src/node.ts";

const geo = loadGeoIndex();
const isochrones = loadIsochrones();

function findStation(name: string, lineId: string): StationNode {
  const station = geo.findStationsByName(name, 100).find((s) => s.lineId === lineId);
  if (!station) throw new Error(`${lineId} の ${name} が見つかりません`);
  return station;
}

// 射線法による点と環の内外判定
function isInsideRing([x, y]: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as LonLat;
    const [xj, yj] = ring[j] as LonLat;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const toPolygons = (feature: IsochroneFeature): LonLat[][][] =>
  feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;

// 外周の内側で、穴の外側にあるか
function isInsideFeature(point: LonLat, feature: IsochroneFeature): boolean {
  return toPolygons(feature).some(
    ([outer, ...holes]) =>
      outer !== undefined &&
      isInsideRing(point, outer) &&
      !holes.some((h) => isInsideRing(point, h)),
  );
}

describe("乗換の徒歩分", () => {
  it("JR大阪と地下鉄梅田は Valhalla の経路で 3〜15 分", () => {
    const osaka = findStation("大阪", "jr-west.東海道線");
    const umeda = geo
      .listTransfers(osaka.stationId)
      .find((t) => t.station.stationId === "osaka-metro.御堂筋線.梅田");
    const edge = loadNetworkData().transfers.find(
      (t) =>
        [t.from, t.to].includes(osaka.stationId) &&
        [t.from, t.to].includes("osaka-metro.御堂筋線.梅田"),
    );
    expect(edge?.walkMinutes).toBeDefined();
    expect(umeda?.walkMinutes).toBe(edge?.walkMinutes);
    expect(umeda?.walkMinutes).toBeGreaterThanOrEqual(3);
    expect(umeda?.walkMinutes).toBeLessThanOrEqual(15);
  });

  it("経路の距離は直線距離より短くならない", () => {
    const shorter = loadNetworkData().transfers.filter(
      (t) => t.walkMetersRoute !== undefined && t.walkMetersRoute < t.walkMeters * 0.9,
    );
    expect(shorter).toEqual([]);
  });

  it("meta.json に OSM の日付と Valhalla の版がある", () => {
    const walk = loadGeoMeta().walk;
    expect(walk?.osm.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(walk?.valhalla.version).toMatch(/^\d+\.\d+/);
    expect(walk?.walkingSpeedKmh).toBe(4.8);
  });
});

describe("到達範囲", () => {
  it.each([
    ["大阪", "jr-west.東海道線"],
    ["京都", "jr-west.東海道線"],
    ["難波", "osaka-metro.御堂筋線"],
    ["天王寺", "osaka-metro.御堂筋線"],
    ["三ノ宮", "jr-west.東海道線"],
  ])("%s（%s）に 10 分と 20 分の範囲がある", (name, lineId) => {
    const station = findStation(name, lineId);
    for (const minutes of [10, 20] as const) {
      const feature = geo.getIsochrone(station.stationId, minutes);
      expect(feature?.properties.minutes).toBe(minutes);
      expect(feature?.properties.stationIds).toContain(station.stationId);
      expect(isInsideFeature(station.lonLat, feature as IsochroneFeature)).toBe(true);
    }
  });

  it("同じ場所の駅は 1 つにまとまる", () => {
    const ids = isochrones?.features.flatMap((f) => f.properties.stationIds) ?? [];
    // 1 か所につき 10 分と 20 分の 2 件
    expect(ids.length).toBe(new Set(ids).size * 2);
  });

  it("10 分の範囲は 20 分の範囲の内側にある", () => {
    const features = isochrones?.features ?? [];
    const byPlace = new Map<string, IsochroneFeature[]>();
    for (const f of features) {
      const key = f.properties.stationIds.join(",");
      byPlace.set(key, [...(byPlace.get(key) ?? []), f]);
    }
    expect(byPlace.size).toBeGreaterThanOrEqual(250);
    let total = 0;
    let outside = 0;
    for (const group of byPlace.values()) {
      const inner = group.find((f) => f.properties.minutes === 10);
      const outer = group.find((f) => f.properties.minutes === 20);
      expect(inner && outer).toBeTruthy();
      for (const polygon of toPolygons(inner as IsochroneFeature)) {
        for (const point of polygon[0] ?? []) {
          total++;
          if (!isInsideFeature(point, outer as IsochroneFeature)) outside++;
        }
      }
    }
    expect(outside / total).toBeLessThanOrEqual(0.001);
  });

  it("範囲の無い駅には null を返す", () => {
    expect(geo.getIsochrone("存在しない駅", 10)).toBeNull();
  });
});

describe("データが無いときの徒歩分", () => {
  const node = (stationId: string, lineId: string, lonLat: LonLat): StationNode => ({
    stationId,
    name: stationId,
    operator: "test",
    lineId,
    lonLat,
    passengers: null,
  });
  const network: NetworkData = {
    version: 1,
    generatedAt: "2026-11-02T00:00:00.000Z",
    nodes: [
      node("a", "l1", [135.5, 34.7]),
      node("b", "l2", [135.501, 34.7]),
      node("c", "l3", [135.502, 34.7]),
    ],
    lines: [],
    edges: [],
    transfers: [
      { from: "a", to: "b", walkMeters: 250 },
      { from: "b", to: "c", walkMeters: 250, walkMinutes: 7, walkMetersRoute: 480 },
    ],
  };

  it("walkMinutes が無ければ直線距離 ÷ 80 に戻る", () => {
    expect(getTransferWalkMinutes({ from: "a", to: "b", walkMeters: 250 })).toBe(4);
    const index = createGeoIndex(network);
    const minutes = new Map(
      index.listTransfers("b").map((t) => [t.station.stationId, t.walkMinutes]),
    );
    expect(minutes.get("a")).toBe(4);
    expect(minutes.get("c")).toBe(7);
  });

  it("経路探索の徒歩辺も同じ徒歩分を使う", () => {
    const links = buildNetworkGraph(network).get("b") ?? [];
    const minutes = new Map(
      links.flatMap((l) => (l.kind === "transfer" ? [[l.to, l.walkMinutes] as const] : [])),
    );
    expect(minutes.get("a")).toBe(4);
    expect(minutes.get("c")).toBe(7);
  });

  it("到達範囲のデータが無ければ null を返す", () => {
    expect(createGeoIndex(network).getIsochrone("a", 10)).toBeNull();
  });
});
