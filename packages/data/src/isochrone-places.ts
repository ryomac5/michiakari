import type { IsochroneGeometry, LonLat, StationNode } from "@repo/geo";
import { computeDistanceMeters, roundTo } from "./geometry.ts";

// 到達範囲を求める主要駅の選び方と、結果の座標の整え方

// 同じ場所とみなす距離。代表点が路線ごとに少しずれるため
export const SAME_PLACE_METERS = 200;
// 同名の駅はこの距離まで同じ場所とみなす（JR 大阪の各線など）
export const SAME_NAME_PLACE_METERS = 500;

export type IsochronePlace = {
  stationName: string;
  lonLat: LonLat;
  stationIds: string[];
  passengers: number;
};

const normalizeName = (name: string) => name.normalize("NFKC").replace(/駅$/, "");

// 乗降客数の多い駅から順に種にし、近くの駅を同じ場所にまとめる
// 場所ごとの乗降客数の合計で並べ、上位 limit か所を返す
export function selectIsochronePlaces(
  nodes: readonly StationNode[],
  limit: number,
): IsochronePlace[] {
  const sorted = [...nodes].sort(
    (a, b) => (b.passengers ?? 0) - (a.passengers ?? 0) || a.stationId.localeCompare(b.stationId),
  );
  const assigned = new Set<string>();
  const places: IsochronePlace[] = [];
  for (const seed of sorted) {
    if (assigned.has(seed.stationId)) continue;
    const seedName = normalizeName(seed.name);
    const members = sorted.filter((n) => {
      if (assigned.has(n.stationId)) return false;
      const meters = computeDistanceMeters(seed.lonLat, n.lonLat);
      return (
        meters <= SAME_PLACE_METERS ||
        (meters <= SAME_NAME_PLACE_METERS && normalizeName(n.name) === seedName)
      );
    });
    for (const m of members) assigned.add(m.stationId);
    places.push({
      stationName: seed.name,
      lonLat: seed.lonLat,
      stationIds: members.map((m) => m.stationId).sort(),
      passengers: members.reduce((sum, m) => sum + (m.passengers ?? 0), 0),
    });
  }
  return places
    .sort((a, b) => b.passengers - a.passengers || a.stationName.localeCompare(b.stationName))
    .slice(0, limit);
}

// 座標を丸め、丸めで重なった連続点を除く。点が 4 未満になった環は捨てる
function roundRing(ring: readonly LonLat[], digits: number): LonLat[] | null {
  const out: LonLat[] = [];
  for (const [lon, lat] of ring) {
    const p: LonLat = [roundTo(lon, digits), roundTo(lat, digits)];
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}

function roundPolygon(rings: readonly LonLat[][], digits: number): LonLat[][] | null {
  const [outer, ...holes] = rings;
  const roundedOuter = outer ? roundRing(outer, digits) : null;
  if (!roundedOuter) return null;
  const roundedHoles = holes
    .map((h) => roundRing(h, digits))
    .filter((h): h is LonLat[] => h !== null);
  return [roundedOuter, ...roundedHoles];
}

export function roundIsochroneGeometry(
  geometry: IsochroneGeometry,
  digits: number,
): IsochroneGeometry | null {
  if (geometry.type === "Polygon") {
    const coordinates = roundPolygon(geometry.coordinates, digits);
    return coordinates ? { type: "Polygon", coordinates } : null;
  }
  const polygons = geometry.coordinates
    .map((p) => roundPolygon(p, digits))
    .filter((p): p is LonLat[][] => p !== null);
  if (polygons.length === 0) return null;
  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] as LonLat[][] }
    : { type: "MultiPolygon", coordinates: polygons };
}
