import {
  applyNetworkCorrections,
  buildNetworkGraph,
  createGeoIndex,
  type NetworkData,
} from "@repo/geo";
import type { MapGeo } from "./scene";
import { listTrackParts, type TrackParts } from "./track-shape";

// 路線・駅のデータを静的に読み込む。地図を開いたときだけ取得するよう動的 import にする

export type LinesGeoJson = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: { lineId: string; lineName: string; operator: string; color: string };
    geometry:
      | { type: "LineString"; coordinates: [number, number][] }
      | { type: "MultiLineString"; coordinates: [number, number][][] };
  }[];
};

// network は入口で行き先までの乗る区間を探すのに使う
export type MapGeoData = MapGeo & { lines: LinesGeoJson; network: NetworkData };

// 路線ごとの線路の形。地図で路線を描く形と同じもの
export function buildTrackShapes(lines: LinesGeoJson): Map<string, TrackParts> {
  return new Map(lines.features.map((f) => [f.properties.lineId, listTrackParts(f.geometry)]));
}

// 経路探索と同じく、網の補正（阪急京都線の大阪梅田発など）を足した網を使う
// 線路の形があれば、止まっている区間をその形に沿って描く
export function createMapGeo(input: NetworkData, lines?: LinesGeoJson): MapGeo {
  const network = applyNetworkCorrections(input);
  return {
    index: createGeoIndex(network),
    graph: buildNetworkGraph(network),
    nodes: network.nodes,
    lineColors: new Map(network.lines.map((l) => [l.lineId, l.color])),
    ...(lines ? { trackShapes: buildTrackShapes(lines) } : {}),
  };
}

// 地図・背景・路線名の英訳で共有する。索引の組み立ては 1 度だけにする
let cached: Promise<MapGeoData> | null = null;

export function loadMapGeoData(): Promise<MapGeoData> {
  cached ??= Promise.all([
    import("@repo/geo/data/network.json").then((m) => m.default as unknown as NetworkData),
    import("@repo/geo/data/lines.geojson").then((m) => m.default as LinesGeoJson),
  ]).then(([network, lines]) => ({ ...createMapGeo(network, lines), lines, network }));
  cached.catch(() => {
    cached = null;
  });
  return cached;
}
