// サーバー専用。route handler からだけ読む
import {
  createGeoIndex,
  type GeoIndex,
  type IsochroneCollection,
  type NetworkData,
} from "@repo/geo";
import isochronesJson from "@repo/geo/data/isochrones.geojson";
import networkJson from "@repo/geo/data/network.json";

// 到達範囲（約 900KB）は画面のバンドルに入れず、サーバーで索引に載せる
// 索引は起動中に一度だけ組み立て、以降は使い回す
let cached: GeoIndex | null = null;

export function loadReachIndex(): GeoIndex {
  cached ??= createGeoIndex(networkJson as unknown as NetworkData, {
    isochrones: isochronesJson as IsochroneCollection,
  });
  return cached;
}
