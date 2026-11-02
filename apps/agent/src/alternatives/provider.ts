import type { LonLat } from "@repo/core";
import type { DurationDist, Lang, Place, RouteOption, Section } from "@repo/schema";

// 代替手段の算出の差し替え口。WS1 の路線ネットワークが来たらこの型で実装を入れ替える

export type AlternativesQuery = {
  origin: Place;
  destination: Place;
  // 止まっている路線と区間。不明なら null
  blockedLine: string | null;
  blockedSection: Section | null;
  now: string;
  // 再開して乗れるまでの残り時間。待つ選択肢に使う。不明なら null
  remaining: DurationDist | null;
  transferServiceActive: boolean | null;
  language: Lang;
};

export type AlternativesResult = {
  // 先頭は必ず待つ選択肢
  options: RouteOption[];
  waitOptionId: string;
  // 再開後に乗ってから目的地に着くまでの分。経路を引けなければ null
  waitRouteMinutesAfterResume: number | null;
  notes: string[];
};

export type ResolvedPlace = {
  name: string;
  coord: LonLat;
};

export type LineInfo = {
  name: string;
  operator: string;
};

export interface AlternativesProvider {
  findAlternatives(query: AlternativesQuery): Promise<AlternativesResult>;
  // 地点を名前と座標に解決する。解決できなければ null
  resolvePlace(place: Place): ResolvedPlace | null;
  // 文章から路線名を拾うための一覧
  listLines(): readonly LineInfo[];
}
