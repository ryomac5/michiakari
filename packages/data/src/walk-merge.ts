import type { GeoMeta, NetworkData, TransferEdge } from "@repo/geo";
import { WALK_ATTRIBUTION } from "../config/sources.ts";

// pnpm data:walk の結果を network.json と meta.json に載せる
// pnpm data:build で作り直しても、同じ乗換の結果は引き継ぐ

export type WalkRouteResult = { walkMinutes: number; walkMetersRoute: number };

export const toTransferKey = (t: Pick<TransferEdge, "from" | "to">) => `${t.from}\u0000${t.to}`;

// 経路の結果を乗換の辺に足す。結果の無い辺は直線距離だけに戻す
export function applyWalkRoutes(
  transfers: readonly TransferEdge[],
  routes: ReadonlyMap<string, WalkRouteResult>,
): TransferEdge[] {
  return transfers.map(({ from, to, walkMeters }) => {
    const route = routes.get(toTransferKey({ from, to }));
    return route ? { from, to, walkMeters, ...route } : { from, to, walkMeters };
  });
}

export function addWalkAttribution(attribution: readonly string[]): string[] {
  return attribution.includes(WALK_ATTRIBUTION)
    ? [...attribution]
    : [...attribution, WALK_ATTRIBUTION];
}

// 両端の駅と直線距離が同じ乗換だけ、前回の徒歩経路を引き継ぐ
// 駅の代表点が動いた乗換は直線距離が変わるので引き継がない
export function carryOverWalkResults(
  previous: { network: NetworkData; meta: GeoMeta } | null,
  next: { network: NetworkData; meta: GeoMeta },
): { network: NetworkData; meta: GeoMeta } {
  const walk = previous?.meta.walk;
  if (!previous || !walk) return next;
  const routes = new Map<string, WalkRouteResult>();
  const nextMeters = new Map(next.network.transfers.map((t) => [toTransferKey(t), t.walkMeters]));
  for (const t of previous.network.transfers) {
    const key = toTransferKey(t);
    if (t.walkMinutes === undefined || t.walkMetersRoute === undefined) continue;
    if (nextMeters.get(key) !== t.walkMeters) continue;
    routes.set(key, { walkMinutes: t.walkMinutes, walkMetersRoute: t.walkMetersRoute });
  }
  const transfers = applyWalkRoutes(next.network.transfers, routes);
  return {
    network: { ...next.network, transfers },
    meta: {
      ...next.meta,
      attribution: addWalkAttribution(next.meta.attribution),
      walk: {
        ...walk,
        counts: { ...walk.counts, transfers: transfers.length, transfersRouted: routes.size },
      },
    },
  };
}
