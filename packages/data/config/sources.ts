// 元データの所在。docs/data-sources.md に記載したものだけを使う

export type SourceArchive = {
  id: "railway" | "passengers" | "bus-stops";
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

// バス停留所 P11 の 2022 年度版。2010 年度版は非商用なので使わない
// 関西 6 府県の府県別の SHP 版の zip を取る。中に UTF-8 の GeoJSON がある
export const BUS_STOP_PREFECTURES = [
  { code: "25", name: "滋賀県" },
  { code: "26", name: "京都府" },
  { code: "27", name: "大阪府" },
  { code: "28", name: "兵庫県" },
  { code: "29", name: "奈良県" },
  { code: "30", name: "和歌山県" },
] as const;

export const BUS_STOP_DATA_YEAR = 2022;

export const BUS_STOP_PAGE_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-2022.html";

export const CC_BY_4_URL = "https://creativecommons.org/licenses/by/4.0/deed.ja";

export const BUS_STOP_SOURCES: readonly SourceArchive[] = BUS_STOP_PREFECTURES.map((p) => ({
  id: "bus-stops",
  name: `国土数値情報（バス停留所データ）${p.name}`,
  dataset: `P11-22_${p.code}`,
  version: "2022年度版（資料時点は概ね2022年8月）",
  pageUrl: BUS_STOP_PAGE_URL,
  zipUrl: `https://nlftp.mlit.go.jp/ksj/gml/data/P11/P11-22/P11-22_${p.code}_SHP.zip`,
  zipFile: `P11-22_${p.code}_SHP.zip`,
  license: "CC BY 4.0",
}));

// 府県別の zip 内の GeoJSON
export const busStopEntry = (dataset: string) => `${dataset}_SHP/${dataset}.geojson`;

// バス停の出典表示（docs/data-sources.md 4章）
export const BUS_STOP_ATTRIBUTION =
  "バス停の位置: 国土交通省「国土数値情報 バス停留所データ」2022年度版を加工して作成。ライセンス: CC BY 4.0";

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
