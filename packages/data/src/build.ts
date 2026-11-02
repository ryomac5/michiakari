import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeoMeta, NetworkData } from "@repo/geo";
import {
  EXCLUDED_OPERATOR_CLASSES,
  EXCLUDED_OPERATORS,
  EXCLUDED_RAILWAY_CLASSES,
  LINE_RENAMES,
  OPERATORS,
} from "../config/operators.ts";
import {
  ATTRIBUTION_LINES,
  PASSENGER_ENTRY,
  PASSENGER_SOURCE,
  RAILWAY_SOURCE,
  SECTION_ENTRY,
  STATION_ENTRY,
} from "../config/sources.ts";
import { downloadArchive } from "./download.ts";
import { createValueTable, openDuckDB, querySqlFile, runSqlFile } from "./duckdb.ts";
import { buildNetwork, type SectionRow, type StationRow } from "./network.ts";
import {
  buildLineFeatures,
  buildStationFeatures,
  type LineGeometryRow,
  writeGeoData,
} from "./output.ts";
import { findTransfers } from "./transfers.ts";

// pnpm data:build の本体。取得 → DuckDB で切り出し・正規化 → 並びと距離 → 書き出し

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(PACKAGE_DIR, ".cache");
const SQL_DIR = join(PACKAGE_DIR, "sql");
const OUT_DIR = join(PACKAGE_DIR, "..", "geo", "data");

const zipEntryPath = (zip: string, entry: string) => `/vsizip/${zip}/${entry}`;

async function loadConfigTables(connection: Awaited<ReturnType<typeof openDuckDB>>) {
  await createValueTable(
    connection,
    "operator_map",
    ["raw_operator", "operator_key", "operator_name"],
    OPERATORS.map((o) => [o.raw, o.key, o.name]),
  );
  await createValueTable(
    connection,
    "line_rename",
    ["raw_operator", "raw_line", "line_name"],
    Object.entries(LINE_RENAMES).map(([key, name]) => {
      const [op = "", line = ""] = key.split(":");
      return [op, line, name];
    }),
  );
  const single = (values: readonly string[]) => values.map((v) => [v]);
  await createValueTable(connection, "excluded_operator", ["value"], single(EXCLUDED_OPERATORS));
  await createValueTable(
    connection,
    "excluded_railway_class",
    ["value"],
    single(EXCLUDED_RAILWAY_CLASSES),
  );
  await createValueTable(
    connection,
    "excluded_operator_class",
    ["value"],
    single(EXCLUDED_OPERATOR_CLASSES),
  );
}

async function main() {
  const railwayZip = await downloadArchive(RAILWAY_SOURCE, CACHE_DIR);
  const passengerZip = await downloadArchive(PASSENGER_SOURCE, CACHE_DIR);

  const connection = await openDuckDB();
  await loadConfigTables(connection);
  await runSqlFile(connection, SQL_DIR, "01_load.sql", {
    AREA_PATH: join(PACKAGE_DIR, "config", "area.geojson"),
    STATION_PATH: zipEntryPath(railwayZip, STATION_ENTRY),
    SECTION_PATH: zipEntryPath(railwayZip, SECTION_ENTRY),
    PASSENGER_PATH: zipEntryPath(passengerZip, PASSENGER_ENTRY),
  });
  await runSqlFile(connection, SQL_DIR, "02_normalize.sql");
  const stations = await querySqlFile<StationRow>(connection, SQL_DIR, "03_stations.sql");
  const sections = await querySqlFile<SectionRow>(connection, SQL_DIR, "04_sections.sql");
  const geometries = await querySqlFile<LineGeometryRow>(
    connection,
    SQL_DIR,
    "05_line_geometry.sql",
  );

  const unknownOperators = [
    ...new Set(
      stations.filter((s) => s.operator_key.startsWith("op-")).map((s) => s.operator_name),
    ),
  ];
  if (unknownOperators.length > 0) {
    console.warn(`正規化表にない事業者（元の名前のまま出力）: ${unknownOperators.join(", ")}`);
  }

  const { lines, nodes, edges, issues } = buildNetwork(stations, sections);
  const missingEn = lines.filter((l) => !l.nameEn || !l.operatorEn).map((l) => l.lineId);
  if (missingEn.length > 0) {
    console.warn(`英語名の表にない路線（日本語名で代用）: ${missingEn.join(", ")}`);
  }
  const transfers = findTransfers(nodes);
  const generatedAt = new Date().toISOString();
  const network: NetworkData = { version: 1, generatedAt, nodes, lines, edges, transfers };
  const meta: GeoMeta = {
    generatedAt,
    attribution: [...ATTRIBUTION_LINES],
    sources: [RAILWAY_SOURCE, PASSENGER_SOURCE].map((s) => ({
      name: s.name,
      dataset: s.dataset,
      version: s.version,
      url: s.pageUrl,
      license: s.license,
    })),
    notes: [
      "対象エリアは packages/data/config/area.geojson のポリゴン。範囲内に駅がある路線を抽出した",
      "新幹線と鋼索鉄道、観光用の路線は除いた",
      "駅の代表点は駅の線データの中点。駅間距離は線路に沿った代表点間の距離の概算",
      "乗換の徒歩距離は代表点どうしの直線距離で、実際の徒歩経路ではない",
      "乗降客数は2024年の値。ない駅は2023年、2022年の順にさかのぼった",
    ],
    counts: {
      lines: lines.length,
      stations: nodes.length,
      edges: edges.length,
      transfers: transfers.length,
    },
  };

  await writeGeoData(OUT_DIR, {
    lineFeatures: buildLineFeatures(lines, geometries),
    stationFeatures: buildStationFeatures(nodes),
    network,
    meta,
  });

  console.log(
    `路線 ${lines.length}、駅 ${nodes.length}、隣接辺 ${edges.length}、乗換辺 ${transfers.length} を ${OUT_DIR} に書き出しました`,
  );
  for (const issue of issues) {
    console.log(`[並びの注意] ${issue.lineId}: ${issue.messages.join(" / ")}`);
  }
}

await main();
