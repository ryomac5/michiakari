import { existsSync, readFileSync } from "node:fs";
import { createGeoIndex, type GeoIndex } from "./geo-index.ts";
import { createRouter, type Router } from "./routing.ts";
import type { GeoMeta, IsochroneCollection, NetworkData } from "./types.ts";

// Node 用の読み込み。ブラウザでは data/ の JSON を取得して createGeoIndex に渡す

const DATA_DIR = new URL("../data/", import.meta.url);

export function loadNetworkData(): NetworkData {
  const data = JSON.parse(readFileSync(new URL("network.json", DATA_DIR), "utf8")) as NetworkData;
  if (data.version !== 1) throw new Error(`network.json の版が想定と違います: ${data.version}`);
  return data;
}

export function loadGeoMeta(): GeoMeta {
  return JSON.parse(readFileSync(new URL("meta.json", DATA_DIR), "utf8")) as GeoMeta;
}

// 到達範囲は pnpm data:walk の生成物。無ければ null
export function loadIsochrones(): IsochroneCollection | null {
  const file = new URL("isochrones.geojson", DATA_DIR);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as IsochroneCollection;
}

export function loadGeoIndex(): GeoIndex {
  return createGeoIndex(loadNetworkData(), { isochrones: loadIsochrones() });
}

export function loadRouter(): Router {
  return createRouter(loadNetworkData());
}
