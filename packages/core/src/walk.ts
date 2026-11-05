import { EARTH_RADIUS_M, WALK_DETOUR_FACTOR, WALK_SPEED_M_PER_MIN } from "../params/walk.ts";

// 徒歩時間の概算。Valhalla が使えるまでの代用

// [経度, 緯度]
export type LonLat = readonly [lon: number, lat: number];

function assertLonLat([lon, lat]: LonLat): void {
  if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) {
    throw new RangeError(`経度・緯度の範囲外です: ${lon}, ${lat}`);
  }
}

const toRadians = (deg: number) => (deg * Math.PI) / 180;

// ハバーシン公式による 2 点間の直線距離（m）
export function computeHaversineMeters(from: LonLat, to: LonLat): number {
  assertLonLat(from);
  assertLonLat(to);
  const dLat = toRadians(to[1] - from[1]);
  const dLon = toRadians(to[0] - from[0]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from[1])) * Math.cos(toRadians(to[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// 徒歩時間（分、切り上げ）= 直線距離 × 迂回係数 ÷ 歩く速さ
export function estimateWalkMinutes(from: LonLat, to: LonLat): number {
  const meters = computeHaversineMeters(from, to) * WALK_DETOUR_FACTOR;
  return computeWalkMinutesFromMeters(meters);
}

// 徒歩時間（分、切り上げ）= 歩く距離 ÷ 歩く速さ
export function computeWalkMinutesFromMeters(meters: number): number {
  if (!Number.isFinite(meters) || meters < 0) {
    throw new RangeError(`距離は 0 以上の有限値: ${meters}`);
  }
  return Math.ceil(meters / WALK_SPEED_M_PER_MIN);
}

// 徒歩の分の上限で届く直線距離（m）。estimateWalkMinutes の逆で、迂回のぶんを差し引く
export function computeWalkReachMeters(maxMinutes: number): number {
  if (!Number.isFinite(maxMinutes) || maxMinutes < 0) {
    throw new RangeError(`分は 0 以上の有限値: ${maxMinutes}`);
  }
  return (maxMinutes * WALK_SPEED_M_PER_MIN) / WALK_DETOUR_FACTOR;
}
