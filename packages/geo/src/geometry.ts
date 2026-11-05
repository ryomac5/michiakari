import type { IsochroneGeometry, LonLat } from "./types.ts";

// 点と多角形の内外判定。経緯度を平面とみなす（徒歩圏の広さなら十分）

// 射線法。環の始点と終点は同じでも違ってもよい
export function isPointInRing([x, y]: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as LonLat;
    const [xj, yj] = ring[j] as LonLat;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 外周の内側で、穴の外側にあるか。MultiPolygon はどれか 1 つに入っていればよい
export function isPointInGeometry(point: LonLat, geometry: IsochroneGeometry): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(
    ([outer, ...holes]) =>
      outer !== undefined &&
      isPointInRing(point, outer) &&
      !holes.some((hole) => isPointInRing(point, hole)),
  );
}
