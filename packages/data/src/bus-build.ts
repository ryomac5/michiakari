import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUS_CHECK_MAX_WALK_MINUTES,
  computeHaversineMeters,
  computeWalkReachMeters,
  type LonLat,
} from "@repo/core";
import type { BusStopFeature, BusStopMeta } from "@repo/geo";
import { BUS_OPERATORS, normalizeBusOperatorName } from "../config/bus-operators.ts";
import {
  BUS_STOP_ATTRIBUTION,
  BUS_STOP_DATA_YEAR,
  BUS_STOP_PAGE_URL,
  BUS_STOP_SOURCES,
  busStopEntry,
  CC_BY_4_URL,
} from "../config/sources.ts";
import { downloadArchive } from "./download.ts";
import { openDuckDB, querySqlFile, runSqlFile } from "./duckdb.ts";
import { roundTo } from "./geometry.ts";
import { serializeFeatureCollection } from "./output.ts";

// バス停留所 P11 の取得 → DuckDB で読み込みと駅の周りの絞り込み → 書き出し

// 駅から確認候補の徒歩の上限で届く距離。これより遠い停留所は画面に出ないので収めない
export const BUS_STOP_STATION_RADIUS_METERS = Math.ceil(
  computeWalkReachMeters(BUS_CHECK_MAX_WALK_MINUTES),
);

// 名前にこの語を含む停留所は外す。P11 にバスの種類の区分が無く、高速バスは市内の代わりの手段にならないため
export const EXCLUDED_BUS_STOP_NAME_PATTERNS: readonly string[] = ["高速バス"];

// 緯度 1 度あたりの距離（m）。少し短めに取り、SQL の四角を広めにする
const METERS_PER_DEGREE_LAT = 111_000;
// 関西で最も北の緯度。経度 1 度の長さが最も短くなる側で四角を取る
const KANSAI_MAX_LAT = 36;

export type BusStopRow = {
  dataset: string;
  record: number;
  name: string;
  raw_operator: string;
  lon: number;
  lat: number;
};

const zipEntryPath = (zip: string, entry: string) => `/vsizip/${zip}/${entry}`;

async function computeSha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

// 代わりの手段にならない停留所を外す
export function excludeUnusableStops(rows: readonly BusStopRow[]): BusStopRow[] {
  return rows.filter((row) => !EXCLUDED_BUS_STOP_NAME_PATTERNS.some((p) => row.name.includes(p)));
}

// 駅のいずれかから半径の内側にある行だけを残す
export function filterNearStations(
  rows: readonly BusStopRow[],
  stations: readonly LonLat[],
  radiusMeters: number,
): BusStopRow[] {
  return rows.filter((row) => {
    const point: LonLat = [row.lon, row.lat];
    return stations.some((s) => computeHaversineMeters(point, s) <= radiusMeters);
  });
}

export function buildBusStopFeatures(rows: readonly BusStopRow[]): BusStopFeature[] {
  return rows.map((row) => ({
    type: "Feature",
    properties: {
      id: `${row.dataset}:${row.record}`,
      name: row.name,
      operator: normalizeBusOperatorName(row.raw_operator),
    },
    geometry: { type: "Point", coordinates: [roundTo(row.lon, 5), roundTo(row.lat, 5)] },
  }));
}

function countByDataset(features: readonly BusStopFeature[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of features) {
    const dataset = f.properties.id.split(":")[0] ?? "";
    counts[dataset] = (counts[dataset] ?? 0) + 1;
  }
  return counts;
}

export async function buildBusStops(options: {
  cacheDir: string;
  sqlDir: string;
  outDir: string;
  stations: readonly LonLat[];
}): Promise<{ count: number }> {
  const zips = [];
  for (const source of BUS_STOP_SOURCES) {
    zips.push({ source, zip: await downloadArchive(source, options.cacheDir) });
  }

  const connection = await openDuckDB();
  await connection.run("SET threads = 1");
  const sqlDir = join(options.sqlDir, "bus");
  for (const { source, zip } of zips) {
    await runSqlFile(connection, sqlDir, "01_load.sql", {
      DATASET: source.dataset,
      PATH: zipEntryPath(zip, busStopEntry(source.dataset)),
    });
  }
  const degLat = BUS_STOP_STATION_RADIUS_METERS / METERS_PER_DEGREE_LAT;
  const degLon = degLat / Math.cos((KANSAI_MAX_LAT * Math.PI) / 180);
  const candidates = await querySqlFile<BusStopRow>(connection, sqlDir, "02_near_stations.sql", {
    STATIONS_PATH: join(options.outDir, "stations.geojson"),
    RADIUS_LAT: degLat.toFixed(6),
    RADIUS_LON: degLon.toFixed(6),
  });
  const rows = filterNearStations(
    excludeUnusableStops(candidates.map((r) => ({ ...r, record: Number(r.record) }))),
    options.stations,
    BUS_STOP_STATION_RADIUS_METERS,
  );
  const features = buildBusStopFeatures(rows);

  const usedOperators = new Set(features.map((f) => f.properties.operator));
  const meta: BusStopMeta = {
    generatedAt: new Date().toISOString(),
    attribution: BUS_STOP_ATTRIBUTION,
    dataYear: BUS_STOP_DATA_YEAR,
    source: {
      name: "国土数値情報（バス停留所データ）",
      version: BUS_STOP_SOURCES[0]?.version ?? "",
      url: BUS_STOP_PAGE_URL,
      license: "CC BY 4.0",
      licenseUrl: CC_BY_4_URL,
      archives: await Promise.all(
        zips.map(async ({ source, zip }) => ({
          dataset: source.dataset,
          zipUrl: source.zipUrl,
          sha256: await computeSha256(zip),
        })),
      ),
    },
    stationRadiusMeters: BUS_STOP_STATION_RADIUS_METERS,
    notes: [
      "関西 6 府県の府県別のデータを読み、路線網の駅の代表点から stationRadiusMeters の内側の停留所だけを収めた",
      "停留所の名前、事業者、位置だけを収めた。系統、時刻、運行の可否は収めていない",
      "名前に「高速バス」を含む停留所は、市内の代わりの手段にならないので外した",
      "事業者名は packages/data/config/bus-operators.ts で表示用に付け替えた",
      "位置は 2022 年の資料による。同じ道路の同じ名前の停留所は元データで 1 点にまとめられている",
      "座標は小数5桁に丸めた",
    ],
    counts: { total: features.length, byDataset: countByDataset(features) },
    operatorLinks: BUS_OPERATORS.filter((o) => usedOperators.has(o.name))
      .map((o) => ({ name: o.name, url: o.url }))
      .filter((o, i, all) => all.findIndex((x) => x.name === o.name) === i),
  };

  await writeFile(join(options.outDir, "bus-stops.geojson"), serializeFeatureCollection(features));
  await writeFile(
    join(options.outDir, "bus-stops-meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  return { count: features.length };
}
