import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  computeHaversineMeters,
  computeWalkMinutesFromMeters,
  estimateWalkMinutes,
} from "@repo/core";
import {
  type GeoMeta,
  ISOCHRONE_MINUTES,
  type IsochroneFeature,
  type NetworkData,
  type StationNode,
} from "@repo/geo";
import { loadGeoMeta, loadNetworkData } from "@repo/geo/node";
import { OSM_SOURCE } from "../config/sources.ts";
import { roundIsochroneGeometry, selectIsochronePlaces } from "./isochrone-places.ts";
import { readOsmSourceInfo } from "./osm-source.ts";
import { type Feature, serializeArrays, serializeFeatureCollection } from "./output.ts";
import {
  fetchValhallaVersion,
  fetchWalkIsochrones,
  fetchWalkRoute,
  VALHALLA_URL,
  WALKING_SPEED_KMH,
} from "./valhalla.ts";
import {
  addWalkAttribution,
  applyWalkRoutes,
  toTransferKey,
  type WalkRouteResult,
} from "./walk-merge.ts";
import { GEO_DATA_DIR, VALHALLA_CACHE_DIR, VALHALLA_COMPOSE_FILE } from "./walk-paths.ts";
import { DETOUR_EXCESS_METERS, DETOUR_RATIO_LIMIT, toWalkRouteResult } from "./walk-route.ts";

// pnpm data:walk の本体。ローカルの Valhalla で乗換の徒歩経路と主要駅の到達範囲を求める
// 起動は infra/valhalla/README.md を見る

const ISOCHRONE_PLACE_LIMIT = 300;
// Valhalla 側の単純化の許容誤差（m）
const ISOCHRONE_GENERALIZE_METERS = 10;
const COORD_DIGITS = 5;
const CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

// 経路が無い乗換と、大回りで採らない乗換は routes に入れない
async function computeTransferRoutes(
  network: NetworkData,
): Promise<{ routes: Map<string, WalkRouteResult>; rejected: string[]; missing: string[] }> {
  const byId = new Map(network.nodes.map((n) => [n.stationId, n]));
  const routes = new Map<string, WalkRouteResult>();
  const rejected: string[] = [];
  const missing: string[] = [];
  await mapWithConcurrency(network.transfers, CONCURRENCY, async (t) => {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    const route = from && to ? await fetchWalkRoute(from.lonLat, to.lonLat) : null;
    const label = `${t.from} ⇔ ${t.to}`;
    if (!route) {
      missing.push(label);
      return;
    }
    const result = toWalkRouteResult(t.walkMeters, route);
    if (!result) {
      rejected.push(`${label}（直線 ${t.walkMeters}m、経路 ${Math.round(route.meters)}m）`);
      return;
    }
    routes.set(toTransferKey(t), result);
  });
  return { routes, rejected: rejected.sort(), missing: missing.sort() };
}

async function computeIsochrones(nodes: readonly StationNode[]): Promise<IsochroneFeature[]> {
  const places = selectIsochronePlaces(nodes, ISOCHRONE_PLACE_LIMIT);
  const perPlace = await mapWithConcurrency(places, CONCURRENCY, async (place) => {
    const contours = await fetchWalkIsochrones(
      place.lonLat,
      ISOCHRONE_MINUTES,
      ISOCHRONE_GENERALIZE_METERS,
    );
    return ISOCHRONE_MINUTES.flatMap((minutes): IsochroneFeature[] => {
      const raw = contours.get(minutes);
      const geometry = raw ? roundIsochroneGeometry(raw, COORD_DIGITS) : null;
      if (!geometry) return [];
      const properties = { stationName: place.stationName, minutes, stationIds: place.stationIds };
      return [{ type: "Feature", properties, geometry }];
    });
  });
  return perPlace.flat();
}

function reportTransferStats(network: NetworkData): void {
  const byId = new Map(network.nodes.map((n) => [n.stationId, n]));
  const vsEstimate: number[] = [];
  const vsStraight: number[] = [];
  for (const t of network.transfers) {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (t.walkMinutes === undefined || !from || !to) continue;
    vsEstimate.push(t.walkMinutes - estimateWalkMinutes(from.lonLat, to.lonLat));
    vsStraight.push(t.walkMinutes - computeWalkMinutesFromMeters(t.walkMeters));
  }
  const describe = (values: number[]) =>
    `中央値 ${median(values)} 分、最大 ${Math.max(...values)} 分、最小 ${Math.min(...values)} 分`;
  console.log(`経路 − 直線×1.3÷80: ${describe(vsEstimate)}`);
  console.log(`経路 − 直線÷80（従来の乗換）: ${describe(vsStraight)}`);
  const ratios = network.transfers.flatMap((t) => {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (t.walkMetersRoute === undefined || !from || !to) return [];
    return [t.walkMetersRoute / Math.max(1, computeHaversineMeters(from.lonLat, to.lonLat))];
  });
  console.log(`経路距離 ÷ 直線距離: 中央値 ${median(ratios).toFixed(2)}`);
}

// 記録用に compose.yaml の image 行を読む
async function readValhallaImage(): Promise<string> {
  const compose = await readFile(VALHALLA_COMPOSE_FILE, "utf8");
  return /^\s*image:\s*(\S+)/m.exec(compose)?.[1] ?? "unknown";
}

async function main() {
  const version = await fetchValhallaVersion();
  if (!version) {
    throw new Error(
      `Valhalla に接続できません（${VALHALLA_URL}）。infra/valhalla/README.md の手順で起動してください`,
    );
  }
  const osm = await readOsmSourceInfo(VALHALLA_CACHE_DIR);
  const network = loadNetworkData();
  const meta = loadGeoMeta();
  console.log(`Valhalla ${version}、OSM ${osm.date}`);

  let started = Date.now();
  const { routes, rejected, missing } = await computeTransferRoutes(network);
  const transfers = applyWalkRoutes(network.transfers, routes);
  console.log(
    `乗換 ${routes.size} / ${transfers.length} の経路を求めました（${((Date.now() - started) / 1000).toFixed(1)} 秒）`,
  );
  for (const label of rejected) console.log(`[大回りのため不採用] ${label}`);
  for (const label of missing) console.log(`[経路なし] ${label}`);

  started = Date.now();
  const isochrones = await computeIsochrones(network.nodes);
  const placeCount = new Set(isochrones.map((f) => f.properties.stationIds.join(","))).size;
  console.log(
    `到達範囲 ${placeCount} か所、${isochrones.length} 件を求めました（${((Date.now() - started) / 1000).toFixed(1)} 秒）`,
  );

  const nextNetwork: NetworkData = { ...network, transfers };
  const nextMeta: GeoMeta = {
    ...meta,
    attribution: addWalkAttribution(meta.attribution),
    walk: {
      computedAt: new Date().toISOString(),
      attribution: "© OpenStreetMap contributors",
      osm: { name: OSM_SOURCE.name, url: osm.url, date: osm.date, license: OSM_SOURCE.license },
      valhalla: { version, image: await readValhallaImage() },
      walkingSpeedKmh: WALKING_SPEED_KMH,
      counts: {
        transfers: transfers.length,
        transfersRouted: routes.size,
        isochronePlaces: placeCount,
      },
      notes: [
        "乗換の walkMinutes と walkMetersRoute は駅の代表点どうしの pedestrian 経路。駅構内の通路は OSM に描かれた範囲で反映される",
        "walkMinutes は Valhalla の所要秒を分に切り上げた値。歩く速さは packages/core と同じ 80m/分",
        "経路が直線距離より短いときは直線距離にそろえた",
        `直線距離の${DETOUR_RATIO_LIMIT}倍を超え、${DETOUR_EXCESS_METERS}m 以上長い経路は代表点の寄せ方の誤りとみなし、${rejected.length} 件を採らなかった。採らなかった乗換と経路の無い乗換 ${missing.length} 件は直線距離から概算する`,
        `到達範囲は乗降客数の上位 ${ISOCHRONE_PLACE_LIMIT} か所。${ISOCHRONE_GENERALIZE_METERS}m の許容誤差で単純化し、座標を小数${COORD_DIGITS}桁に丸めた`,
      ],
    },
  };

  await writeFile(join(GEO_DATA_DIR, "network.json"), serializeArrays(nextNetwork));
  await writeFile(
    join(GEO_DATA_DIR, "isochrones.geojson"),
    serializeFeatureCollection(isochrones as unknown as Feature[]),
  );
  await writeFile(join(GEO_DATA_DIR, "meta.json"), `${JSON.stringify(nextMeta, null, 2)}\n`);
  reportTransferStats(nextNetwork);
}

await main();
