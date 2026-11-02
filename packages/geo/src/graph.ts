import type { LineType, NetworkData } from "./types.ts";

// 経路探索用の隣接リスト。乗車の辺は双方向、乗換の辺も双方向に張る
// 探索アルゴリズムは持たない。乗車時間は packages/core の計算と組み合わせて求める

export type RideLink = {
  kind: "ride";
  to: string;
  lineId: string;
  lineType: LineType;
  distanceKm: number;
};

export type TransferLink = {
  kind: "transfer";
  to: string;
  walkMeters: number;
};

export type GraphLink = RideLink | TransferLink;

export type NetworkGraph = ReadonlyMap<string, readonly GraphLink[]>;

export function buildNetworkGraph(network: NetworkData): NetworkGraph {
  const graph = new Map<string, GraphLink[]>(network.nodes.map((n) => [n.stationId, []]));
  const link = (from: string, entry: GraphLink) => graph.get(from)?.push(entry);
  for (const e of network.edges) {
    const ride = (to: string): RideLink => ({
      kind: "ride",
      to,
      lineId: e.lineId,
      lineType: e.lineType,
      distanceKm: e.distanceKm,
    });
    link(e.from, ride(e.to));
    link(e.to, ride(e.from));
  }
  for (const t of network.transfers) {
    link(t.from, { kind: "transfer", to: t.to, walkMeters: t.walkMeters });
    link(t.to, { kind: "transfer", to: t.from, walkMeters: t.walkMeters });
  }
  return graph;
}
