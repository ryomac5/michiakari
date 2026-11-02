import type { Place } from "@repo/schema";
import type { Station } from "./fixtures/stations";

// 駅の検索と、地点の表示名の解決

function normalizeQuery(text: string): string {
  // カタカナはひらがなに寄せ、英字は小文字にする
  return text
    .trim()
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・-]/g, "");
}

function matchScore(station: Station, query: string): number {
  const keys = [station.name, station.kana, normalizeQuery(station.nameEn)].map(normalizeQuery);
  if (keys.some((k) => k === query)) return 0;
  if (keys.some((k) => k.startsWith(query))) return 1;
  if (keys.some((k) => k.includes(query))) return 2;
  return Number.POSITIVE_INFINITY;
}

// 一致の度合い（完全一致 → 前方一致 → 部分一致）で並べて返す
export function searchStations(stations: Station[], text: string, limit = 8): Station[] {
  const query = normalizeQuery(text);
  if (query === "") return [];
  return stations
    .map((station) => ({ station, score: matchScore(station, query) }))
    .filter((r) => Number.isFinite(r.score))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((r) => r.station);
}

export function findStationByName(stations: Station[], name: string): Station | undefined {
  return stations.find((s) => s.name === name);
}

export function pickStationName(station: Station, locale: string): string {
  return locale === "en" ? station.nameEn : station.name;
}

// 駅名の地点は一覧にあれば言語に合わせ、無ければ入力のまま表示する
export function describeStationPlace(
  stations: Station[],
  place: Extract<Place, { kind: "station" }>,
  locale: string,
): string {
  const station = findStationByName(stations, place.name);
  return station ? pickStationName(station, locale) : place.name;
}

// 2 点間の大圏距離（メートル）。最寄り駅の目安を出すためだけに使う
export function measureDistanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function findNearestStation(
  stations: Station[],
  point: { lat: number; lon: number },
): { station: Station; meters: number } | undefined {
  let best: { station: Station; meters: number } | undefined;
  for (const station of stations) {
    const meters = measureDistanceMeters(point, station);
    if (best === undefined || meters < best.meters) best = { station, meters };
  }
  return best;
}
