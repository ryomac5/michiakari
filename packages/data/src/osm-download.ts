import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { OSM_SOURCE } from "../config/sources.ts";
import { type OsmSourceInfo, parseGeofabrikDate } from "./osm-source.ts";
import { VALHALLA_CACHE_DIR } from "./walk-paths.ts";

// pnpm data:osm の本体。Geofabrik の関西抽出を .cache/valhalla/ に取得する
// 既にあれば取得しない。取り直すときは --force を付ける

async function main() {
  const target = join(VALHALLA_CACHE_DIR, OSM_SOURCE.pbfFile);
  if (existsSync(target) && !process.argv.includes("--force")) {
    console.log(`取得済み: ${target}（取り直すときは --force）`);
    return;
  }
  await mkdir(VALHALLA_CACHE_DIR, { recursive: true });
  console.log(`取得: ${OSM_SOURCE.latestUrl}`);
  const res = await fetch(OSM_SOURCE.latestUrl);
  if (!res.ok || !res.body) {
    throw new Error(`取得に失敗しました: ${OSM_SOURCE.latestUrl} (${res.status})`);
  }
  const info: OsmSourceInfo = {
    url: res.url,
    date: parseGeofabrikDate(res.url),
    downloadedAt: new Date().toISOString(),
  };
  const partial = `${target}.partial`;
  await pipeline(Readable.fromWeb(res.body as ReadableStream), createWriteStream(partial));
  await rename(partial, target);
  await writeFile(
    join(VALHALLA_CACHE_DIR, OSM_SOURCE.infoFile),
    `${JSON.stringify(info, null, 2)}\n`,
  );
  console.log(`${info.url}（${info.date}）を ${target} に保存しました`);
}

await main();
