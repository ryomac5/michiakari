import { computeWalkMinutesFromMeters } from "@repo/core";
import type { WalkRoute } from "./valhalla.ts";
import type { WalkRouteResult } from "./walk-merge.ts";

// Valhalla の経路を乗換の徒歩分に直す
// 駅の代表点は線路の上にあり、線路や水路の反対側の道に寄せられることがある
// その場合は大回りの経路になるので採らず、従来の直線距離からの概算に任せる

// 直線距離のこの倍を超え、かつこの距離（m）以上長い経路は寄せ方の誤りとみなす
export const DETOUR_RATIO_LIMIT = 2.5;
export const DETOUR_EXCESS_METERS = 400;

export function isImplausibleDetour(straightMeters: number, routeMeters: number): boolean {
  return (
    routeMeters > straightMeters * DETOUR_RATIO_LIMIT &&
    routeMeters - straightMeters > DETOUR_EXCESS_METERS
  );
}

// 採らない経路は null。経路は直線より短くならないので、短いときは直線距離にそろえる
export function toWalkRouteResult(
  straightMeters: number,
  route: WalkRoute,
): WalkRouteResult | null {
  if (isImplausibleDetour(straightMeters, route.meters)) return null;
  return {
    walkMinutes: Math.max(
      1,
      Math.ceil(route.seconds / 60),
      computeWalkMinutesFromMeters(straightMeters),
    ),
    walkMetersRoute: Math.round(Math.max(route.meters, straightMeters)),
  };
}
