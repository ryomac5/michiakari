import { buildNetworkGraph, createGeoIndex, type NetworkData } from "@repo/geo";
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

export function createMapGeo(network: NetworkData): MapGeo {
  return {
    index: createGeoIndex(network),
    graph: buildNetworkGraph(network),
    nodes: network.nodes,
    lineColors: new Map(network.lines.map((l) => [l.lineId, l.color])),
  };
}

export async function loadMapGeoData(): Promise<MapGeoData> {
  const [network, lines] = await Promise.all([
    import("@repo/geo/data/network.json").then((m) => m.default as unknown as NetworkData),
    import("@repo/geo/data/lines.geojson").then((m) => m.default as LinesGeoJson),
  ]);
  return { ...createMapGeo(network), lines };
}
