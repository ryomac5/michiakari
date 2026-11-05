import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OSM_SOURCE } from "../config/sources.ts";

// 取得した OSM 抽出の版。pnpm data:osm が書き、pnpm data:walk が meta.json に写す

export type OsmSourceInfo = {
  url: string;
  // Geofabrik のファイル名の日付（YYYY-MM-DD）。この日までの編集を含む
  date: string;
  downloadedAt: string;
};

// kansai-261101.osm.pbf → 2026-11-01
export function parseGeofabrikDate(url: string): string {
  const match = /-(\d{2})(\d{2})(\d{2})\.osm\.pbf$/.exec(url);
  if (!match) throw new Error(`Geofabrik のファイル名から日付を読めません: ${url}`);
  return `20${match[1]}-${match[2]}-${match[3]}`;
}

export async function readOsmSourceInfo(cacheDir: string): Promise<OsmSourceInfo> {
  const text = await readFile(join(cacheDir, OSM_SOURCE.infoFile), "utf8");
  return JSON.parse(text) as OsmSourceInfo;
}
