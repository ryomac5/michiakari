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

// 乗り換え先の追加の費用。covered は振替輸送の対象で追加の運賃がかからない。fare_required は運賃がかかる
// 利用者の乗車券の種類から packages/core が決める。決められなければ持たない
export const TransferFareSchema = z.enum(["covered", "fare_required"]);
export type TransferFare = z.infer<typeof TransferFareSchema>;

export const RouteOptionSchema = z.object({
  id: IdSchema,
  kind: z.enum(["wait", "transfer", "taxi", "walk"]),
  label: z.string(),
  legs: z.array(RouteLegSchema),
  arrivalTime: IsoDateTimeSchema,
  fareYen: NonNegativeIntSchema.nullable(),
  walkMinutes: NonNegativeIntSchema,
  isTransferService: z.boolean(),
  transferFare: TransferFareSchema.optional(),
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

// 再開の見込みの出どころ。規則表、原因の統計値、どちらも無い。画面には説明の文を出さず、前提の言い方を選ぶのに使う
// rule は種類が分かり、規則表の止まり方と目安を使った。発表の時刻や再開の放送で見込んだときも、種類が分かれば rule
export const ESTIMATE_SOURCES = ["rule", "statistics", "none"] as const;

// 以前の記録の knowledge は境界で rule に読み替える
export const EstimateSourceSchema = z.preprocess(
  (value) => (value === "knowledge" ? "rule" : value),
  z.enum(ESTIMATE_SOURCES),
);
export type EstimateSource = z.infer<typeof EstimateSourceSchema>;

// 事象を特定できないときは eventType を null にし、分岐点だけで判断を返す
// eventType は統計値の種類の id（packages/core の IncidentTypeId）。照合は core が行う
// 種類が分からなくても入口で答えた原因の統計値があれば、remaining を統計値から詰める
export const EstimateSchema = z.object({
  eventType: IdSchema.nullable(),
  // 事象の段階は使わない。以前の記録との互換のため残し、agent は常に null にする
  phaseId: IdSchema.nullable(),
  // 発生とみなした時刻からの経過（分）
  elapsedMinutes: NonNegativeIntSchema.nullable(),
  remaining: DurationDistSchema.nullable(),
  confidence: ConfidenceSchema,
  // 省略は以前の記録との互換のため。agent は常に詰める
  source: EstimateSourceSchema.optional(),
});
export type Estimate = z.infer<typeof EstimateSchema>;

// 根拠の種類。signal は発表の引用、cue は放送の手がかり、weather は気象、computation は計算
// signal の id は統計値の種類の id、cue の id は手がかりの id
export const EvidenceKindSchema = z.enum(["signal", "cue", "weather", "computation"]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceSchema = z.object({
  kind: EvidenceKindSchema,
  id: z.string().min(1),
  description: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// 駅間の車内の人への案内。結論は車内で待つだけにし、ほかの手段はいまの選択肢として並べない
// 次の駅に着いた後のほうが早い手段があるときだけ、着いた後の次の一手を 1 つ持つ。サーバーが決定論で詰める
export const AfterAlightStepSchema = z.object({
  kind: z.enum(["transfer", "taxi", "walk"]),
  // 画面に 1 行で出す文。例: 「福島に着いたら阪神本線へ」
  text: z.string().min(1),
  // 最初に乗る路線と駅。タクシーと徒歩では null
  line: z.string().nullable(),
  boardStation: z.string().nullable(),
  // 行き先に着く見込み。次の駅に着く見込みの時刻を起点に求めたもの
  arrivalTime: IsoDateTimeSchema,
});
export type AfterAlightStep = z.infer<typeof AfterAlightStepSchema>;

export const InCarGuideSchema = z.object({
  // ホームに着けて降りられる駅。次の駅が分からなければ null
  alightStation: z.string().min(1).nullable(),
  // その駅に着く見込み。見込みが無ければ null
  alightArrival: IsoDateTimeSchema.nullable(),
  // 自分の列車が動き出す見込み。見込みが無ければ null
  departure: IsoDateTimeSchema.nullable(),
  afterAlight: AfterAlightStepSchema.nullable(),
});
export type InCarGuide = z.infer<typeof InCarGuideSchema>;

// 行動を変える放送と発表の手がかり。packages/core の detectAnnouncementCues が拾う
export const ANNOUNCEMENT_CUE_IDS = [
  // 運転を再開した
  "resumed",
  // まもなく再開する、順次再開する
  "resume_soon",
  // 救援の列車や人が向かう
  "rescue",
  // 防護無線を受けて止まった
  "protection_received",
  // 前の列車がつかえて先へ進めない
  "queue_ahead",
  // 線路の安全が確かめられた
  "track_cleared",
] as const;
export const AnnouncementCueIdSchema = z.enum(ANNOUNCEMENT_CUE_IDS);
export type AnnouncementCueId = z.infer<typeof AnnouncementCueIdSchema>;

// 利用者がいる線路。affected は当該の線路、opposite は反対の線路、unknown は分からない
export const TRACK_SIDES = ["affected", "opposite", "unknown"] as const;
export const TrackSideSchema = z.enum(TRACK_SIDES);
export type TrackSide = z.infer<typeof TrackSideSchema>;

// 防護無線の事象で、支障の無い線路が先に動き出す見込み。いまからの分。packages/core の estimateUnaffectedTrackResume の出力
// どちら側か分からなければ両方を持つ
export const UnaffectedTrackSchema = z.object({
  trackSide: TrackSideSchema,
  // 当該の線路の再開までの残り。当該の線路にいないと分かれば null。見込みが無くても null
  affected: DurationDistSchema.nullable(),
  // 反対の線路と並ぶ同じ会社の線の再開までの残り。当該の線路にいると分かれば null
  opposite: DurationDistSchema.nullable(),
});
export type UnaffectedTrack = z.infer<typeof UnaffectedTrackSchema>;

// 再開後の詰まりの見込み。packages/core の estimateQueueAfterResume の出力
export const ResumeQueueSchema = z.object({
  // 事業者が駅間の列車を詰めるか。詰めない事業者では waitRange が null
  closesUp: z.boolean(),
  // 自分の前に詰まる列車の本数
  trainsInQueue: NonNegativeIntSchema,
  // 自分の番が来るまでの分の範囲
  waitRange: z
    .object({ minMinutes: NonNegativeIntSchema, maxMinutes: NonNegativeIntSchema })
    .nullable(),
  // 詰まりの放送が聞こえたか
  queueAnnounced: z.boolean(),
  // 次の駅で降りて別の手段に乗り換える価値があるか
  worthAlightingAtNextStation: z.boolean(),
});
export type ResumeQueue = z.infer<typeof ResumeQueueSchema>;

// 電車の中で止まった利用者の列車が、なぜ止まったか。packages/core の estimateStopReasons が決める
// own_incident は当該列車、protection_received は防護無線の受信、dispatcher_order は指令の指示、queued_behind は前の列車の詰まり
export const STOP_REASONS = [
  "own_incident",
  "protection_received",
  "dispatcher_order",
  "queued_behind",
] as const;
export const StopReasonSchema = z.enum(STOP_REASONS);
export type StopReason = z.infer<typeof StopReasonSchema>;

const ShareSchema = z.number().min(0).max(1);
const TrainCountSchema = z.number().nonnegative();

// 止まった理由ごとの割合。止まる列車の本数の比から求める。値は開発者の推定
export const StopReasonsSchema = z.object({
  // 理由ごとの割合。手がかりで確定させた後の値で、足すと 1 になる
  shares: z.object({
    own_incident: ShareSchema,
    protection_received: ShareSchema,
    dispatcher_order: ShareSchema,
    queued_behind: ShareSchema,
  }),
  // いちばん可能性の高い理由
  mostLikely: StopReasonSchema,
  // 理由ごとに止まる列車の本数の見積もり。手がかりで確定させる前の値
  trainCounts: z.object({
    own_incident: TrainCountSchema,
    protection_received: TrainCountSchema,
    dispatcher_order: TrainCountSchema,
    queued_behind: TrainCountSchema,
  }),
});
export type StopReasons = z.infer<typeof StopReasonsSchema>;

// 規則から出した見込みの欄。判断の結果と phase_estimated イベントが同じ欄を持つ。どれも任意
export const RuleOutlookShape = {
  // 自分の列車が止まった理由の見込み。電車の中にいる利用者のときだけ付く
  stopReasons: StopReasonsSchema.optional(),
  // 観測から拾った手がかりの id
  cues: z.array(AnnouncementCueIdSchema).optional(),
  // 防護無線の事象か。周りの同じ会社の列車も一斉に止まる
  protection: z.boolean().optional(),
  // 支障の無い線路が先に動く見込み。防護無線の事象のときだけ付く
  unaffectedTrack: UnaffectedTrackSchema.optional(),
  // 再開後の詰まりの見込み。列車の中にいるときか、詰まりの放送が聞こえたときだけ付く
  resumeQueue: ResumeQueueSchema.optional(),
};

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
  ...RuleOutlookShape,
  // 近くのバス停の確認候補。判断の確定後にサーバーが決定論で付ける。無ければ画面は欄を出さない
  busChecks: z.array(BusCheckSchema).max(BUS_CHECK_LIMIT).optional(),
  // 駅間の車内の人への案内。駅にいる人には付けない。付いていれば options は空で、action は wait
  inCar: InCarGuideSchema.optional(),
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

  if (j.inCar && j.action !== "wait") {
    errors.push("駅間の車内の人には切り替えを勧めず、action を wait にしてください");
  }

  if (j.recommendedOptionId !== null && !j.options.some((o) => o.id === j.recommendedOptionId)) {
    errors.push(`recommendedOptionId が options に存在しません: ${j.recommendedOptionId}`);
  }

  return errors;
}
