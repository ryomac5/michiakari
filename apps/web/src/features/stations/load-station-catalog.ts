// サーバー専用。route handler からだけ読む
import { createGeoIndex, type GeoIndex, type NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { buildStationCatalog, type StationCatalog } from "./catalog";

// @repo/geo/node の loadGeoIndex は import.meta.url からデータの場所を解くため、Next のバンドルでは解決できない
// 同じ network.json を JSON として取り込み、同じ createGeoIndex で索引を作る
// 駅データは起動中に一度だけ組み立て、以降は使い回す
let cached: { index: GeoIndex; catalog: StationCatalog } | null = null;

export function loadStationCatalog(): { index: GeoIndex; catalog: StationCatalog } {
  if (cached === null) {
    const network = networkJson as unknown as NetworkData;
    cached = {
      index: createGeoIndex(network),
      catalog: buildStationCatalog(network.nodes, network.lines),
    };
  }
  return cached;
}
