import {
  applyNetworkCorrections,
  buildNetworkGraph,
  createGeoIndex,
  type NetworkData,
} from "@repo/geo";
import type { MapGeo } from "./scene";

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

export type MapGeoData = MapGeo & { lines: LinesGeoJson };

// 経路探索と同じく、網の補正（阪急京都線の大阪梅田発など）を足した網を使う
export function createMapGeo(input: NetworkData): MapGeo {
  const network = applyNetworkCorrections(input);
  return {
    index: createGeoIndex(network),
    graph: buildNetworkGraph(network),
    nodes: network.nodes,
    lineColors: new Map(network.lines.map((l) => [l.lineId, l.color])),
  };
}

// 地図・背景・路線名の英訳で共有する。索引の組み立ては 1 度だけにする
let cached: Promise<MapGeoData> | null = null;

export function loadMapGeoData(): Promise<MapGeoData> {
  cached ??= Promise.all([
    import("@repo/geo/data/network.json").then((m) => m.default as unknown as NetworkData),
    import("@repo/geo/data/lines.geojson").then((m) => m.default as LinesGeoJson),
  ]).then(([network, lines]) => ({ ...createMapGeo(network), lines }));
  cached.catch(() => {
    cached = null;
  });
  return cached;
}
