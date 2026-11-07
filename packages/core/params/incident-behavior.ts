// 種類ごとの振る舞いの規則表。止まり方、防護無線、長さの見込み、短い事象の目安、初列車待ち
// 出典: 開発者の推定。外から観察できる振る舞いの目安で、社内規程の数値や手順ではない

import type { DurationDist } from "@repo/schema";
import type { IncidentTypeId } from "./incident-durations.ts";

export const INCIDENT_BEHAVIOR_SOURCE = "開発者の推定";

// 止まり方
// train_only: その列車だけが止まる。車内の対応が済めばすぐ動く
// train_first: その列車から止まり、後ろの列車が詰まる。発表で区間が出れば区間の見合わせになる
// section: 周りの列車も止まり、区間が止まる
export const STOP_KINDS = ["train_only", "train_first", "section"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

// 防護無線を出すか。always は出す、maybe は出すことがある、none は出さない
// 公開の出典: docs/research/rail-operations/01-protection-radio.md。受信で止める範囲は自社線に限る
export const PROTECTION_LEVELS = ["always", "maybe", "none"] as const;
export type ProtectionLevel = (typeof PROTECTION_LEVELS)[number];

// 長さの見込み。unknown は数字を言い切らない
export const INCIDENT_FLOW_OUTLOOKS = ["short", "long", "very_long", "unknown"] as const;
export type IncidentFlowOutlook = (typeof INCIDENT_FLOW_OUTLOOKS)[number];

// 再開してから乗れる列車が来るまでの分。止まり方ごとの目安
// 出典: 開発者の推定（仮）
export const FIRST_TRAIN_WAIT_BY_STOP_KIND: Readonly<Record<StopKind, DurationDist>> = {
  train_only: { p50: 2, p80: 5 },
  train_first: { p50: 5, p80: 15 },
  section: { p50: 10, p80: 25 },
};

export type IncidentBehavior = {
  stopKind: StopKind;
  protection: ProtectionLevel;
  flowOutlook: IncidentFlowOutlook;
  // 短く終わる事象の、発生から再開までの目安（分）。短い事象でなければ null
  ruleRange: DurationDist | null;
  // 再開から乗れる列車までの分。止まり方の表から引く
  firstTrainWait: DurationDist;
  // めったに無い事象。見込みの数字を言い切らない
  rare: boolean;
  // 確かめが済んだ手がかりがあるときだけ ruleRange を使う。無ければ統計値に落とす
  ruleNeedsCheck: boolean;
  // 天気が収まっても、点検が終わるまで再開しない。点検が続く間は再開が近い手がかりを数えない
  // 出典: docs/research/rail-operations/04-weather-regulation.md の共通の流れ
  resumeAfterInspection: boolean;
};

type BehaviorRow = Omit<
  IncidentBehavior,
  "firstTrainWait" | "rare" | "ruleNeedsCheck" | "resumeAfterInspection"
> & {
  rare?: boolean;
  ruleNeedsCheck?: boolean;
  resumeAfterInspection?: boolean;
};

const shortRange = (p50: number, p80: number): DurationDist => ({ p50, p80 });

// p80 は仮の値
const BEHAVIOR_ROWS: Readonly<Record<IncidentTypeId, BehaviorRow>> = {
  // 防護無線を出す事象
  person_collision: {
    stopKind: "section",
    protection: "always",
    flowOutlook: "long",
    ruleRange: null,
  },
  track_intrusion: {
    stopKind: "section",
    protection: "always",
    flowOutlook: "short",
    ruleRange: shortRange(10, 30),
  },
  crossing_obstruction: {
    stopKind: "section",
    protection: "always",
    flowOutlook: "long",
    ruleRange: null,
  },
  track_structure_damage: {
    stopKind: "section",
    protection: "always",
    flowOutlook: "long",
    ruleRange: null,
  },
  building_falling_object: {
    stopKind: "section",
    protection: "always",
    flowOutlook: "long",
    ruleRange: null,
  },
  track_smoke_check: {
    stopKind: "section",
    protection: "always",
    flowOutlook: "long",
    ruleRange: null,
  },
  crossing_collision: {
    stopKind: "section",
    protection: "always",
    flowOutlook: "very_long",
    ruleRange: null,
  },
  derailment: {
    stopKind: "section",
    protection: "always",
    flowOutlook: "very_long",
    ruleRange: null,
  },
  onboard_fire: {
    stopKind: "section",
    protection: "always",
    flowOutlook: "very_long",
    ruleRange: null,
  },
  // 防護無線を出すことがある事象
  vegetation_obstruction: {
    stopKind: "section",
    protection: "maybe",
    flowOutlook: "long",
    ruleRange: null,
  },
  foreign_object: {
    stopKind: "section",
    protection: "maybe",
    flowOutlook: "long",
    ruleRange: null,
  },
  animal_collision: {
    stopKind: "section",
    protection: "maybe",
    flowOutlook: "long",
    ruleRange: null,
  },
  bridge_impact: { stopKind: "section", protection: "maybe", flowOutlook: "long", ruleRange: null },
  // 車内非常ブザーの事象。急病人は次の駅で駅員に引き継ぎ、すぐ動く
  medical_response: {
    stopKind: "train_only",
    protection: "none",
    flowOutlook: "short",
    ruleRange: shortRange(5, 15),
  },
  passenger_conflict: {
    stopKind: "train_only",
    protection: "none",
    flowOutlook: "short",
    ruleRange: shortRange(5, 15),
  },
  // 駅で止めて確かめる。目安はすぐ確かめられたときに限る。周りへの広がりは分からないので区間とみなす
  suspicious_object: {
    stopKind: "section",
    protection: "none",
    flowOutlook: "short",
    ruleRange: shortRange(10, 30),
    ruleNeedsCheck: true,
  },
  // その列車から止まる設備と車両の事象
  vehicle_failure: {
    stopKind: "train_first",
    protection: "none",
    flowOutlook: "long",
    ruleRange: null,
  },
  vehicle_smoke: {
    stopKind: "train_first",
    protection: "none",
    flowOutlook: "long",
    ruleRange: null,
  },
  signal_failure: {
    stopKind: "train_first",
    protection: "none",
    flowOutlook: "long",
    ruleRange: null,
  },
  point_failure: {
    stopKind: "train_first",
    protection: "none",
    flowOutlook: "long",
    ruleRange: null,
  },
  // 大雨と強風は区間ごとに上下とも止まる。強風のうち台風は特に長い。地震は揺れた所が止まる
  heavy_rain: {
    stopKind: "section",
    protection: "none",
    flowOutlook: "long",
    ruleRange: null,
    resumeAfterInspection: true,
  },
  strong_wind: {
    stopKind: "section",
    protection: "none",
    flowOutlook: "long",
    ruleRange: null,
    resumeAfterInspection: true,
  },
  earthquake: {
    stopKind: "section",
    protection: "none",
    flowOutlook: "long",
    ruleRange: null,
    resumeAfterInspection: true,
  },
  snow_ice: { stopKind: "section", protection: "none", flowOutlook: "long", ruleRange: null },
  lightning: {
    stopKind: "section",
    protection: "none",
    flowOutlook: "unknown",
    ruleRange: null,
    rare: true,
  },
  // 止まり方が分からない種類は区間とみなす
  power_outage: { stopKind: "section", protection: "none", flowOutlook: "long", ruleRange: null },
  heat_rail_deformation: {
    stopKind: "section",
    protection: "none",
    flowOutlook: "long",
    ruleRange: null,
  },
};

function buildBehaviorTable(): Readonly<Record<IncidentTypeId, IncidentBehavior>> {
  const entries = Object.entries(BEHAVIOR_ROWS).map(([id, row]) => [
    id,
    {
      ...row,
      rare: row.rare ?? false,
      ruleNeedsCheck: row.ruleNeedsCheck ?? false,
      resumeAfterInspection: row.resumeAfterInspection ?? false,
      firstTrainWait: FIRST_TRAIN_WAIT_BY_STOP_KIND[row.stopKind],
    },
  ]);
  return Object.fromEntries(entries) as Record<IncidentTypeId, IncidentBehavior>;
}

export const INCIDENT_BEHAVIOR: Readonly<Record<IncidentTypeId, IncidentBehavior>> =
  buildBehaviorTable();

// 種類が分からないときの初列車待ち。区間が止まるものとみなす
export const UNKNOWN_FIRST_TRAIN_WAIT: DurationDist = FIRST_TRAIN_WAIT_BY_STOP_KIND.section;

// 防護無線の事象で、支障の無い線路が確かめを終えて動き出すまでの目安（分）
export const UNAFFECTED_TRACK_RESUME: DurationDist = { p50: 10, p80: 15 };

// 再開後の詰まりで、平均の駅間の距離（km）。距離しか分からないとき駅の数に直す
// 出典: 開発者の推定（仮）。関西の都市部の駅間を丸めた値
export const AVERAGE_STATION_SPACING_KM = 1.5;

// 自分の番までの分の上限がこれ以上なら、次の駅で降りて乗り換える価値があるとみなす
// 出典: 開発者の推定（仮）
export const QUEUE_ALIGHT_WORTH_MINUTES = 10;

// 発表にこの語があれば、天気の事象の長さの見込みを very_long に上げる。台風は特に長い
// 出典: 開発者の推定
export const VERY_LONG_WEATHER_PHRASES: readonly string[] = ["台風", "typhoon"];
