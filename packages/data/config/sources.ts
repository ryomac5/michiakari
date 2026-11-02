// 元データの所在。docs/data-sources.md に記載したものだけを使う

export type SourceArchive = {
  id: "railway" | "passengers";
  name: string;
  dataset: string;
  version: string;
  pageUrl: string;
  zipUrl: string;
  zipFile: string;
  license: string;
};

export const RAILWAY_SOURCE: SourceArchive = {
  id: "railway",
  name: "国土数値情報（鉄道データ）",
  dataset: "N02-25",
  version: "2025年度版（データ基準日 2025年12月31日）",
  pageUrl: "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html",
  zipUrl: "https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-25/N02-25_GML.zip",
  zipFile: "N02-25_GML.zip",
  license: "CC BY 4.0（公共データ利用規約 第1.0版）",
};

export const PASSENGER_SOURCE: SourceArchive = {
  id: "passengers",
  name: "国土数値情報（駅別乗降客数データ）",
  dataset: "S12-25",
  version: "2024年度版（最新の値は2024年の統計）",
  pageUrl: "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-S12-2024.html",
  zipUrl: "https://nlftp.mlit.go.jp/ksj/gml/data/S12/S12-25/S12-25_GML.zip",
  zipFile: "S12-25_GML.zip",
  license: "CC BY 4.0（公共データ利用規約 第1.0版）",
};

// zip 内の GeoJSON（UTF-8 版）
export const STATION_ENTRY = "N02-25_GML/UTF-8/N02-25_Station.geojson";
export const SECTION_ENTRY = "N02-25_GML/UTF-8/N02-25_RailroadSection.geojson";
export const PASSENGER_ENTRY = "S12-25_GML/UTF-8/S12-25_NumberOfPassengers.geojson";

// 徒歩経路の計算に使う OpenStreetMap の関西抽出（Geofabrik 配布）。ODbL
// latest の URL は日付入りのファイルへ転送されるので、その日付を版として記録する
export const OSM_SOURCE = {
  name: "OpenStreetMap（Geofabrik 関西抽出）",
  latestUrl: "https://download.geofabrik.de/asia/japan/kansai-latest.osm.pbf",
  pbfFile: "kansai.osm.pbf",
  infoFile: "osm-source.json",
  license: "ODbL 1.0",
};

// 徒歩経路と到達範囲の出典表示
export const WALK_ATTRIBUTION =
  "徒歩経路・到達範囲: © OpenStreetMap contributors のデータから Valhalla で計算";

// 画面に出す出典表示（docs/data-sources.md 4章）
export const ATTRIBUTION_LINES: readonly string[] = [
  "鉄道データ: 「国土数値情報（鉄道データ）」（国土交通省）を加工して作成",
  "駅の乗降客数: 「国土数値情報（駅別乗降客数データ）」（国土交通省）を加工して作成",
];
