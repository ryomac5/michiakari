import { estimateWalkMinutes } from "@repo/core";
import { computeDistanceMeters } from "./distance.ts";
import type { BusOperatorLink, BusStop, BusStopCollection, LonLat } from "./types.ts";

// 駅か位置から歩いて確かめに行けるバス停。到着時刻は持たず、確認先の候補だけを返す

// 同じ名前で近い停留所のまとまり。stops は徒歩の短い順で、事業者ごとに 1 つ
export type WalkAccessBusStop = {
  name: string;
  stops: BusStop[];
  // いちばん近い停留所までの徒歩の分
  walkMinutes: number;
};

export type BusStopQuery = {
  stops: readonly BusStop[];
  origin: LonLat;
  // 徒歩の上限（分）
  maxWalkMinutes: number;
  // 同じ名前の停留所をまとめる距離（m）
  sameNameMeters: number;
  limit: number;
};

// GeoJSON と出典の情報から停留所の一覧を作る。公式の案内は事業者名で引く
export function parseBusStops(
  collection: BusStopCollection,
  links: readonly BusOperatorLink[],
): BusStop[] {
  const urls = new Map(links.map((l) => [l.name, l.url]));
  return collection.features.map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    operator: f.properties.operator,
    officialUrl: urls.get(f.properties.operator) ?? null,
    lonLat: f.geometry.coordinates,
  }));
}

// 停留所を、先に置いた近いほうの同じ名前のまとまりに足す。同じ事業者は重ねない
function addToGroups(
  groups: WalkAccessBusStop[],
  stop: BusStop,
  walkMinutes: number,
  sameNameMeters: number,
): void {
  const group = groups.find(
    (g) =>
      g.name === stop.name &&
      g.stops[0] !== undefined &&
      computeDistanceMeters(g.stops[0].lonLat, stop.lonLat) <= sameNameMeters,
  );
  if (!group) {
    groups.push({ name: stop.name, stops: [stop], walkMinutes });
    return;
  }
  if (!group.stops.some((s) => s.operator === stop.operator)) group.stops.push(stop);
}

// 徒歩の短い順に、上限の分の内側の停留所をまとめて limit 件まで返す。徒歩は core の概算
export function listWalkAccessBusStops(query: BusStopQuery): WalkAccessBusStop[] {
  const reachable = query.stops
    .map((stop) => ({ stop, walkMinutes: estimateWalkMinutes(query.origin, stop.lonLat) }))
    .filter((r) => r.walkMinutes <= query.maxWalkMinutes)
    .sort((a, b) => a.walkMinutes - b.walkMinutes || a.stop.id.localeCompare(b.stop.id));
  const groups: WalkAccessBusStop[] = [];
  for (const r of reachable) addToGroups(groups, r.stop, r.walkMinutes, query.sameNameMeters);
  return groups.slice(0, Math.max(0, query.limit));
}
