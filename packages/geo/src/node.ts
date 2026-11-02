import { readFileSync } from "node:fs";
import { createGeoIndex, type GeoIndex } from "./geo-index.ts";
import type { GeoMeta, NetworkData } from "./types.ts";

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

export function loadGeoIndex(): GeoIndex {
  return createGeoIndex(loadNetworkData());
}
