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
  // 英語の利用者向けの路線名と事業者名。表にない路線は持たない
  nameEn?: string;
  operatorEn?: string;
  aliases: string[];
  lineType: LineType;
  color: string;
  segments: LineSegment[];
};

// ネットワークのノード。路線ごとの駅
export type StationNode = {
  stationId: string;
  name: string;
  // 主要駅だけ持つ英語名。読みのない駅は持たない
  nameEn?: string;
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

// 乗換の候補。walkMeters は駅の代表点どうしの直線距離
// walkMinutes と walkMetersRoute は Valhalla の徒歩経路。pnpm data:walk が足す
export type TransferEdge = {
  from: string;
  to: string;
  walkMeters: number;
  walkMinutes?: number;
  walkMetersRoute?: number;
};

// 到達範囲の徒歩分。pnpm data:walk が計算する分だけを持つ
export const ISOCHRONE_MINUTES = [10, 20] as const;
export type IsochroneMinutes = (typeof ISOCHRONE_MINUTES)[number];

export type IsochroneGeometry =
  | { type: "Polygon"; coordinates: LonLat[][] }
  | { type: "MultiPolygon"; coordinates: LonLat[][][] };

// 主要駅の徒歩の到達範囲。同じ場所の駅は 1 つにまとめ、stationIds に並べる
export type IsochroneFeature = {
  type: "Feature";
  properties: {
    stationName: string;
    minutes: IsochroneMinutes;
    stationIds: string[];
  };
  geometry: IsochroneGeometry;
};

export type IsochroneCollection = {
  type: "FeatureCollection";
  features: IsochroneFeature[];
};

// 徒歩経路の計算条件。pnpm data:walk が meta.json に書く
export type WalkMeta = {
  computedAt: string;
  attribution: string;
  osm: { name: string; url: string; date: string; license: string };
  valhalla: { version: string; image: string };
  walkingSpeedKmh: number;
  counts: {
    transfers: number;
    transfersRouted: number;
    isochronePlaces: number;
  };
  notes: string[];
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
  // pnpm data:walk を実行していなければ持たない
  walk?: WalkMeta;
};
