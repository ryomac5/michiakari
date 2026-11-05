import { estimateWalkMinutes } from "@repo/core";
import type { BusOperatorLink, BusStop, BusStopCollection, LonLat } from "./types.ts";

// 駅か位置から歩いて確かめに行けるバス停。到着時刻は持たず、確認先の候補だけを返す

export type WalkAccessBusStop = {
  stop: BusStop;
  walkMinutes: number;
};

export type BusStopQuery = {
  stops: readonly BusStop[];
  origin: LonLat;
  // 徒歩の上限（分）
  maxWalkMinutes: number;
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

// 同じ名前で同じ事業者の停留所は、近いほうの 1 つにまとめる
const buildStopKey = (stop: BusStop) => `${stop.operator}\u0000${stop.name}`;

// 徒歩の短い順に、上限の分の内側の停留所を limit 件まで返す。徒歩は core の概算
export function listWalkAccessBusStops(query: BusStopQuery): WalkAccessBusStop[] {
  const nearest = new Map<string, WalkAccessBusStop>();
  for (const stop of query.stops) {
    const walkMinutes = estimateWalkMinutes(query.origin, stop.lonLat);
    if (walkMinutes > query.maxWalkMinutes) continue;
    const key = buildStopKey(stop);
    const current = nearest.get(key);
    if (!current || walkMinutes < current.walkMinutes) nearest.set(key, { stop, walkMinutes });
  }
  return [...nearest.values()]
    .sort((a, b) => a.walkMinutes - b.walkMinutes || a.stop.id.localeCompare(b.stop.id))
    .slice(0, Math.max(0, query.limit));
}
