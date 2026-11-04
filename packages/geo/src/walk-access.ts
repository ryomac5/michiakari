import { estimateWalkMinutes } from "@repo/core";
import { computeDistanceMeters } from "./distance.ts";
import type { NetworkGraph } from "./graph.ts";
import type { StationNode } from "./types.ts";

// 現在地の駅から歩いて乗りに行ける別の鉄道の駅。地図の吹き出しと代替手段の探索が、この関数で同じ駅を選ぶ

// 同じ駅とみなす距離（m）
export const SAME_STATION_METERS = 300;

// 同じ駅の路線違いか。名前と事業者が同じで近い駅（心斎橋の御堂筋線と長堀鶴見緑地線など）
// 事業者が違う同名の駅（JR と阪急の宝塚など）は、歩いて乗り換える別の駅として扱う
export function isSameStation(a: StationNode, b: StationNode): boolean {
  return (
    a.name === b.name &&
    a.operator === b.operator &&
    computeDistanceMeters(a.lonLat, b.lonLat) <= SAME_STATION_METERS
  );
}

// transfer: 路線データの乗換の徒歩。estimate: 直線距離からの概算
export type WalkAccessSource = "transfer" | "estimate";

export type WalkAccessStation = {
  station: StationNode;
  walkMinutes: number;
  source: WalkAccessSource;
};

export type WalkAccessQuery = {
  nodes: readonly StationNode[];
  graph: NetworkGraph;
  origin: StationNode;
  // 止まっている路線。この路線の駅へは歩いて乗りに行かない
  blockedLineIds: readonly string[];
  // 徒歩の上限（分）。この分数までの駅を返す
  maxWalkMinutes: number;
};

// 現在地の駅から乗換の辺でつながる駅ごとの、路線データの徒歩の分
function mapTransferMinutes(graph: NetworkGraph, origin: StationNode): Map<string, number> {
  const minutes = new Map<string, number>();
  for (const link of graph.get(origin.stationId) ?? []) {
    if (link.kind !== "transfer") continue;
    minutes.set(link.to, Math.min(link.walkMinutes, minutes.get(link.to) ?? link.walkMinutes));
  }
  return minutes;
}

// 歩いて乗りに行ける駅を、徒歩の短い順に返す。現在地と同じ駅と、止まっている路線の駅は含めない
// 徒歩の分は、乗換の辺が路線データにあればそれを、無ければ core の概算を使う
export function listWalkAccessStations(query: WalkAccessQuery): WalkAccessStation[] {
  const { origin } = query;
  const transferMinutes = mapTransferMinutes(query.graph, origin);
  return query.nodes
    .filter((n) => !isSameStation(n, origin) && !query.blockedLineIds.includes(n.lineId))
    .map((station): WalkAccessStation => {
      const fromTransfer = transferMinutes.get(station.stationId);
      return fromTransfer !== undefined
        ? { station, walkMinutes: fromTransfer, source: "transfer" }
        : {
            station,
            walkMinutes: estimateWalkMinutes(origin.lonLat, station.lonLat),
            source: "estimate",
          };
    })
    .filter((w) => w.walkMinutes <= query.maxWalkMinutes)
    .sort(
      (a, b) =>
        a.walkMinutes - b.walkMinutes || a.station.stationId.localeCompare(b.station.stationId),
    );
}
