// 距離計算と座標の丸め

export type Coord = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

export function computeDistanceMeters(a: readonly number[], b: readonly number[]): number {
  const [lon1 = 0, lat1 = 0] = a;
  const [lon2 = 0, lat2 = 0] = b;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function computePolylineKm(coords: readonly Coord[]): number {
  let meters = 0;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    if (prev && curr) meters += computeDistanceMeters(prev, curr);
  }
  return meters / 1000;
}

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// GeoJSON の座標配列を入れ子の深さによらず丸める
export function roundCoordinates<T>(coords: T, digits: number): T {
  if (typeof coords === "number") return roundTo(coords, digits) as T;
  if (Array.isArray(coords)) return coords.map((c) => roundCoordinates(c, digits)) as T;
  return coords;
}

// LineString / MultiLineString の GeoJSON から線の配列を取り出す
export function extractLines(geometry: { type: string; coordinates: unknown }): Coord[][] {
  if (geometry.type === "LineString") return [geometry.coordinates as Coord[]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as Coord[][];
  return [];
}
