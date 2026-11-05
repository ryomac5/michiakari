import { z } from "zod";
import {
  ActionSchema,
  ConfidenceSchema,
  DurationDistSchema,
  IdSchema,
  IsoDateTimeSchema,
  NonNegativeIntSchema,
} from "./common.ts";
import { findDuplicateIds } from "./internal.ts";
import { TypicalFlowSchema } from "./typical-flow.ts";

// emit_judgment の出力。Claude のツール定義に変換するため refine で ID 参照を検査しない

export const RouteLegSchema = z.object({
  mode: z.enum(["walk", "ride", "wait", "taxi"]),
  from: z.string(),
  to: z.string(),
  minutes: NonNegativeIntSchema,
  line: z.string().optional(),
  // 地図に経路を描くための構造化情報。駅 ID と路線 ID は packages/geo のもの
  fromStationId: z.string().optional(),
  toStationId: z.string().optional(),
  lineId: z.string().optional(),
});
export type RouteLeg = z.infer<typeof RouteLegSchema>;

export const RouteOptionSchema = z.object({
  id: IdSchema,
  kind: z.enum(["wait", "transfer", "taxi", "walk"]),
  label: z.string(),
  legs: z.array(RouteLegSchema),
  arrivalTime: IsoDateTimeSchema,
  fareYen: NonNegativeIntSchema.nullable(),
  walkMinutes: NonNegativeIntSchema,
  isTransferService: z.boolean(),
});
export type RouteOption = z.infer<typeof RouteOptionSchema>;

// 近くのバス停の確認候補。国土数値情報 P11 の停留所の位置と徒歩の目安だけを持つ
// 到着時刻を持たないので、到着の比較・境目・おすすめには入れない。時刻と運行可否は出さない
export const BUS_CHECK_LIMIT = 3;

export const BusOperatorSchema = z.object({
  name: z.string().min(1),
  // 事業者の公式の案内。トップか路線案内のページ。確認済みの URL が無ければ null
  officialUrl: z.url().nullable(),
});
export type BusOperator = z.infer<typeof BusOperatorSchema>;

// 同じ名前で近い停留所は 1 件にまとめ、事業者を並べる
export const BusCheckSchema = z.object({
  // いちばん近い停留所の、元データの版とレコードの対応。例: P11-22_27:1234
  id: z.string().min(1),
  stopName: z.string().min(1),
  operators: z.array(BusOperatorSchema).min(1),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  // 起点の駅か現在地から、いちばん近い停留所までの徒歩の概算（分）
  walkMinutes: NonNegativeIntSchema,
  // 位置情報の資料の年
  dataYear: z.number().int(),
});
export type BusCheck = z.infer<typeof BusCheckSchema>;

// 1 割単位に丸めた確率。0 は 1 割未満、10 は 9 割以上を表し、0% と 100% は出さない
export const ChanceTenthsSchema = z.number().int().min(0).max(10);
export type ChanceTenths = z.infer<typeof ChanceTenthsSchema>;

export const ResumeChanceTickSchema = z.object({
  time: IsoDateTimeSchema,
  // この時刻までに動いている確率
  tenths: ChanceTenthsSchema,
  // 発生とみなした時刻からの分。発生が分からなければ null
  sinceOnsetMinutes: NonNegativeIntSchema.nullable(),
});
export type ResumeChanceTick = z.infer<typeof ResumeChanceTickSchema>;

// 時刻ごとの再開の見込みと、待ったほうが早く着く確率。packages/core の computeResumeChance の出力
// 分岐点の比べ方を確率にしたものなので、分岐点と一緒に届ける
export const ResumeChanceSchema = z.object({
  // 目盛りの刻み（分）
  stepMinutes: z.number().int().positive(),
  // 切りのよい時刻の目盛り。いまから、ほぼ動いている時刻までを覆う
  ticks: z.array(ResumeChanceTickSchema).min(4).max(6),
  // 待ったほうが早く着く確率 P(T_wait ≤ T_alternative)。代替手段が無ければ null
  waitFaster: ChanceTenthsSchema.nullable(),
  // 待って期限に間に合う確率 P(T_wait ≤ 期限)。期限か経路が無ければ null
  waitOnTime: ChanceTenthsSchema.nullable(),
  // 期限に間に合うために動いていなければならない時刻。waitOnTime が null なら null
  resumeByForDeadline: IsoDateTimeSchema.nullable(),
  // 発生とみなした時刻。分からなければ null
  onsetTime: IsoDateTimeSchema.nullable(),
});
export type ResumeChance = z.infer<typeof ResumeChanceSchema>;

export const BreakEvenSchema = z.object({
  time: IsoDateTimeSchema,
  explanation: z.string(),
  // 時刻ごとの再開の見込みと、待ったほうが早く着く確率。残り時間の見込みがあるときに agent が詰める。無ければ画面は出さない
  resumeChance: ResumeChanceSchema.optional(),
});
export type BreakEven = z.infer<typeof BreakEvenSchema>;

// 事象を特定できないときは eventType を null にし、分岐点だけで判断を返す
export const EstimateSchema = z.object({
  eventType: IdSchema.nullable(),
  phaseId: IdSchema.nullable(),
  elapsedMinutes: NonNegativeIntSchema.nullable(),
  remaining: DurationDistSchema.nullable(),
  confidence: ConfidenceSchema,
});
export type Estimate = z.infer<typeof EstimateSchema>;

export const EvidenceSchema = z.object({
  kind: z.enum(["signal", "knowledge", "weather", "computation"]),
  id: z.string().min(1),
  description: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const JudgmentSchema = z.object({
  action: ActionSchema,
  headline: z.string().min(1),
  // 結論の理由を 1〜2 文で。任意で、無ければ画面は見出しだけを出す
  reason: z.string().min(1).optional(),
  breakEven: BreakEvenSchema.nullable(),
  estimate: EstimateSchema,
  options: z.array(RouteOptionSchema),
  recommendedOptionId: IdSchema.nullable(),
  evidence: z.array(EvidenceSchema),
  disclaimer: z.string().min(1),
  // 事象のよくある流れ。サーバーが知見から詰める。原因が分からないときは入れない
  typicalFlow: TypicalFlowSchema.optional(),
  // 近くのバス停の確認候補。判断の確定後にサーバーが決定論で付ける。無ければ画面は欄を出さない
  busChecks: z.array(BusCheckSchema).max(BUS_CHECK_LIMIT).optional(),
});
export type Judgment = z.infer<typeof JudgmentSchema>;

// options の id の一意性と推奨する代替手段の参照を検査し、問題をエラー文字列で返す
export function checkJudgmentRefs(j: Judgment): string[] {
  const errors: string[] = [];

  for (const id of findDuplicateIds(j.options.map((o) => o.id))) {
    errors.push(`options の id が重複しています: ${id}`);
  }

  if (j.action === "switch" && j.recommendedOptionId === null) {
    errors.push("action が switch のときは recommendedOptionId が必要です");
  }

  if (j.recommendedOptionId !== null && !j.options.some((o) => o.id === j.recommendedOptionId)) {
    errors.push(`recommendedOptionId が options に存在しません: ${j.recommendedOptionId}`);
  }

  return errors;
}
