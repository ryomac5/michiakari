import type { LonLat } from "@repo/core";
import type { BusCheck, DurationDist, Lang, Place, RouteOption, Section } from "@repo/schema";

// 代替手段の算出の差し替え口。WS1 の路線ネットワークが来たらこの型で実装を入れ替える

export type AlternativesQuery = {
  origin: Place;
  destination: Place;
  // 止まっている路線と区間。不明なら null
  blockedLine: string | null;
  blockedSection: Section | null;
  now: string;
  // 代替手段に乗り出せる時刻。駅間の車内なら次の駅に着く見込み。省略すれば now
  departureTime?: string;
  // 再開後に、乗ったまま待つ側の到着へ足す分。駅間の車内なら、前の列車が先に発車するぶんの遅れ
  extraWaitMinutesAfterResume?: number;
  // 再開して乗れるまでの残り時間。待つ選択肢に使う。不明なら null
  remaining: DurationDist | null;
  transferServiceActive: boolean | null;
  language: Lang;
};

// 駅間の車内から見た前の駅。次の駅から順に並べる
export type StationsAheadQuery = {
  line: string | null;
  previousStation: string;
  nextStation: string;
  limit: number;
  // 時間帯の判定に使う時刻
  departureTime: string;
};

export type StationsAhead = {
  lineId: string;
  stations: { name: string; rideMinutesFromPrevious: number }[];
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
  // 来た側の駅と次の駅から、その先の駅と駅間の走行時間を並べる。路線上で結べなければ null
  listStationsAhead(query: StationsAheadQuery): StationsAhead | null;
  // 出発地から歩いて確かめに行けるバス停。判断の確定後に付け、判断の材料には渡さない
  listBusChecks(place: Place): BusCheck[];
}
