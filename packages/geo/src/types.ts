// geo のデータ型。packages/data の前処理が出力し、ここで読む
// packages/schema に地理データのスキーマがないため、ここに置く

import type { LineType } from "@repo/schema";

// 路線種別の定義は packages/schema が唯一の正
export { LINE_TYPES, type LineType } from "@repo/schema";

// [経度, 緯度]
export type LonLat = readonly [number, number];

// 路線上の駅の並び。分岐のある路線は区間ごとに分かれる
export type LineSegment = {
  stationIds: string[];
  // 区間の先頭からの累積距離（km）。stationIds と同じ長さ
  cumulativeKm: number[];
  // 環状運転の区間なら、末尾の駅から先頭の駅に戻る
  loop: boolean;
  // 区間の全長（km）。環状なら一周の長さ
  lengthKm: number;
};

export type LineInfo = {
  lineId: string;
  operator: string;
  operatorKey: string;
  lineName: string;
  aliases: string[];
  lineType: LineType;
  color: string;
  segments: LineSegment[];
};

// ネットワークのノード。路線ごとの駅
export type StationNode = {
  stationId: string;
  name: string;
  // 主要駅だけ持つ読み（ひらがな）
  reading?: string;
  operator: string;
  lineId: string;
  lonLat: LonLat;
  // 1日の乗降客数。データがない駅は null
  passengers: number | null;
};

// 同じ路線の隣接駅を結ぶ辺。向きはなく、往復とも使える
export type RideEdge = {
  from: string;
  to: string;
  lineId: string;
  lineType: LineType;
  distanceKm: number;
};

// 乗換の候補。徒歩距離は駅の代表点どうしの直線距離
export type TransferEdge = {
  from: string;
  to: string;
  walkMeters: number;
};

export type NetworkData = {
  version: 1;
  generatedAt: string;
  nodes: StationNode[];
  lines: LineInfo[];
  edges: RideEdge[];
  transfers: TransferEdge[];
};

export type GeoMeta = {
  generatedAt: string;
  attribution: string[];
  sources: {
    name: string;
    dataset: string;
    version: string;
    url: string;
    license: string;
  }[];
  notes: string[];
  counts: {
    lines: number;
    stations: number;
    edges: number;
    transfers: number;
  };
};
