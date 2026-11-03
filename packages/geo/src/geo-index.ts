import { applyNetworkCorrections, listExtendedStationAliases } from "./corrections.ts";
import { computeDistanceMeters } from "./distance.ts";
import { buildNetworkGraph, type NetworkGraph } from "./graph.ts";
import { normalizeSearchText } from "./text.ts";
import type {
  IsochroneCollection,
  IsochroneFeature,
  IsochroneMinutes,
  LineInfo,
  LonLat,
  NetworkData,
  StationNode,
  TransferEdge,
} from "./types.ts";
import { getTransferWalkMinutes } from "./walk.ts";

// 路線・駅の参照。データは引数で受け取り、Node でもブラウザでも使える

export type NearestStation = {
  station: StationNode;
  distanceMeters: number;
};

// 2駅を直接結ぶ路線。乗換候補として結ばれた近くの駅（300m以内）も同じ場所とみなす
export type LineBetween = {
  line: LineInfo;
  from: StationNode;
  to: StationNode;
  distanceKm: number;
};

// walkMeters は直線距離。walkMinutes は Valhalla の経路があればその分、無ければ概算
export type TransferOption = {
  station: StationNode;
  walkMeters: number;
  walkMinutes: number;
};

export type GeoIndexOptions = {
  // 主要駅の到達範囲。無ければ getIsochrone は常に null を返す
  isochrones?: IsochroneCollection | null;
};

export type GeoIndex = {
  findStationsByName: (query: string, limit?: number) => StationNode[];
  getStation: (stationId: string) => StationNode | undefined;
  findNearestStations: (lonLat: LonLat, n: number) => NearestStation[];
  getLine: (lineId: string) => LineInfo | undefined;
  listLines: () => LineInfo[];
  listStationsOnLine: (lineId: string) => StationNode[];
  listTransfers: (stationId: string) => TransferOption[];
  listLinesBetween: (fromStationId: string, toStationId: string) => LineBetween[];
  buildNetworkGraph: () => NetworkGraph;
  getIsochrone: (stationId: string, minutes: IsochroneMinutes) => IsochroneFeature | null;
};

const SAME_PLACE_WALK_METERS = 300;

type SearchEntry = { station: StationNode; keys: string[] };

function rankMatch(keys: readonly string[], query: string): number | undefined {
  let best: number | undefined;
  for (const key of keys) {
    const rank =
      key === query ? 0 : key.startsWith(query) ? 1 : key.includes(query) ? 2 : undefined;
    if (rank !== undefined && (best === undefined || rank < best)) best = rank;
  }
  return best;
}

function indexTransfers(transfers: readonly TransferEdge[]): Map<string, TransferEdge[]> {
  const byStation = new Map<string, TransferEdge[]>();
  for (const t of transfers) {
    for (const id of [t.from, t.to]) {
      const list = byStation.get(id) ?? [];
      list.push(t);
      byStation.set(id, list);
    }
  }
  return byStation;
}

// 同じ路線の辺だけをたどる最短距離
function computeLineDistanceKm(
  graph: NetworkGraph,
  lineId: string,
  from: string,
  to: string,
): number | undefined {
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  while (queue.length > 0) {
    queue.sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
    const v = queue.shift() as string;
    if (v === to) return dist.get(v);
    for (const link of graph.get(v) ?? []) {
      if (link.kind !== "ride" || link.lineId !== lineId) continue;
      const nd = (dist.get(v) ?? 0) + link.distanceKm;
      if (nd < (dist.get(link.to) ?? Number.POSITIVE_INFINITY)) {
        if (!dist.has(link.to)) queue.push(link.to);
        dist.set(link.to, nd);
      }
    }
  }
  return undefined;
}

function indexIsochrones(
  isochrones: IsochroneCollection | null | undefined,
): Map<string, IsochroneFeature> {
  const byKey = new Map<string, IsochroneFeature>();
  for (const feature of isochrones?.features ?? []) {
    for (const id of feature.properties.stationIds) {
      byKey.set(`${id}\u0000${feature.properties.minutes}`, feature);
    }
  }
  return byKey;
}

export function createGeoIndex(input: NetworkData, options: GeoIndexOptions = {}): GeoIndex {
  const network = applyNetworkCorrections(input);
  const stationById = new Map(network.nodes.map((n) => [n.stationId, n]));
  const lineById = new Map(network.lines.map((l) => [l.lineId, l]));
  const transfersByStation = indexTransfers(network.transfers);
  const isochroneByKey = indexIsochrones(options.isochrones);
  // 補正で写した駅は、写した元の駅の到達範囲を使う
  for (const alias of listExtendedStationAliases(network)) {
    for (const [key, feature] of [...isochroneByKey]) {
      const [id, minutes] = key.split("\u0000");
      if (id === alias.sourceStationId)
        isochroneByKey.set(`${alias.stationId}\u0000${minutes}`, feature);
    }
  }
  const searchEntries: SearchEntry[] = network.nodes.map((station) => ({
    station,
    keys: [station.name, station.reading]
      .filter((k): k is string => Boolean(k))
      .map(normalizeSearchText),
  }));
  let graph: NetworkGraph | undefined;
  const getGraph = () => {
    graph ??= buildNetworkGraph(network);
    return graph;
  };

  const listTransfers = (stationId: string): TransferOption[] =>
    (transfersByStation.get(stationId) ?? []).flatMap((t) => {
      const other = stationById.get(t.from === stationId ? t.to : t.from);
      return other
        ? [{ station: other, walkMeters: t.walkMeters, walkMinutes: getTransferWalkMinutes(t) }]
        : [];
    });

  const listSamePlace = (stationId: string): StationNode[] => {
    const self = stationById.get(stationId);
    if (!self) return [];
    const near = listTransfers(stationId)
      .filter((t) => t.walkMeters <= SAME_PLACE_WALK_METERS)
      .map((t) => t.station);
    return [self, ...near];
  };

  return {
    findStationsByName(query, limit = 20) {
      const q = normalizeSearchText(query);
      if (q.length === 0) return [];
      return searchEntries
        .flatMap((e) => {
          const rank = rankMatch(e.keys, q);
          return rank === undefined ? [] : [{ station: e.station, rank }];
        })
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            (b.station.passengers ?? 0) - (a.station.passengers ?? 0) ||
            a.station.stationId.localeCompare(b.station.stationId),
        )
        .slice(0, limit)
        .map((m) => m.station);
    },

    getStation: (stationId) => stationById.get(stationId),

    findNearestStations(lonLat, n) {
      return network.nodes
        .map((station) => ({
          station,
          distanceMeters: computeDistanceMeters(lonLat, station.lonLat),
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, n);
    },

    getLine: (lineId) => lineById.get(lineId),

    listLines: () => [...network.lines],

    listStationsOnLine(lineId) {
      const ids = new Set(lineById.get(lineId)?.segments.flatMap((s) => s.stationIds) ?? []);
      return [...ids].flatMap((id) => stationById.get(id) ?? []);
    },

    listTransfers,

    listLinesBetween(fromStationId, toStationId) {
      const results: LineBetween[] = [];
      for (const from of listSamePlace(fromStationId)) {
        for (const to of listSamePlace(toStationId)) {
          if (from.lineId !== to.lineId || from.stationId === to.stationId) continue;
          const line = lineById.get(from.lineId);
          const distanceKm = computeLineDistanceKm(
            getGraph(),
            from.lineId,
            from.stationId,
            to.stationId,
          );
          if (line && distanceKm !== undefined) results.push({ line, from, to, distanceKm });
        }
      }
      return results.sort((a, b) => a.distanceKm - b.distanceKm);
    },

    buildNetworkGraph: () => buildNetworkGraph(network),

    getIsochrone: (stationId, minutes) =>
      isochroneByKey.get(`${stationId}\u0000${minutes}`) ?? null,
  };
}
