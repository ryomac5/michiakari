import { z } from "zod";
import { IdSchema, IsoDateTimeSchema, LangSchema, TrainTypeSchema } from "./common.ts";
import { MAX_INPUT_TEXT_LENGTH, ObservationSchema, RawInputSchema } from "./observation.ts";

// POST /judge の入力

export const PlaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("station"), name: z.string().min(1) }),
  z.object({
    kind: z.literal("coord"),
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
  }),
]);
export type Place = z.infer<typeof PlaceSchema>;

export const UserConstraintsSchema = z.object({
  deadline: IsoDateTimeSchema.nullable(),
  knowsAlternatives: z.boolean(),
  mobilityNotes: z.string().max(MAX_INPUT_TEXT_LENGTH).nullable(),
});
export type UserConstraints = z.infer<typeof UserConstraintsSchema>;

export { type TrainType, TrainTypeSchema } from "./common.ts";

// 前に詰まっている本数の目安。種別の並びが分からないときに使う
export const TrainsAheadCountSchema = z.enum(["none", "few", "many", "unknown"]);
export type TrainsAheadCount = z.infer<typeof TrainsAheadCountSchema>;

// 利用者の車内の位置。駅にいる、駅に止まっている車内、駅と駅の間の 3 つ
// 駅間のときだけ、次の駅・来た側の駅・前の列車の種別の並び・自分の種別を持つ
export const TrainPositionSchema = z.object({
  kind: z.enum(["at_station", "on_train_at_station", "between_stations"]),
  nextStation: z.string().nullable(),
  previousStation: z.string().nullable(),
  // 前に止まっている列車の種別を近い順に並べる。空なら前に列車はいない。分からなければ null
  trainsAhead: z.array(TrainTypeSchema).nullable(),
  // 並びが分からないときの本数の目安。並びがあれば null
  trainsAheadCount: TrainsAheadCountSchema.nullable(),
  ownTrainType: TrainTypeSchema.nullable(),
  // 前の列車の並びを運転パターンから推し量ったときの、同じ線路の運転間隔（分）
  // 値があれば前の列車はふだんの間隔で先を走っていたとみなす。無ければ目の前に詰まっているとみなす
  trainsAheadHeadwayMinutes: z.number().positive().nullable().optional(),
});
export type TrainPosition = z.infer<typeof TrainPositionSchema>;

// 入口で利用者が答えた原因。統計値の大分類と種類の id で持つ。種類を聞かない大分類では type は null
// 知見の無い原因でも、この原因の統計値から再開の見込みを出す。id の照合は packages/core が行う
export const IncidentCauseSchema = z.object({
  group: IdSchema,
  type: IdSchema.nullable(),
});
export type IncidentCause = z.infer<typeof IncidentCauseSchema>;

// 入口で、車内で「信号を受信したため緊急停止」の放送を聞いたかの答え
export const ProtectionBroadcastSchema = z.enum(["heard", "not_heard", "unknown"]);
export type ProtectionBroadcast = z.infer<typeof ProtectionBroadcastSchema>;
// 入口で答えた乗車券の種類。IC カード、定期券、紙の切符。分からないと答えたときは送らない
export const TicketTypeSchema = z.enum(["ic", "commuter_pass", "paper"]);
export type TicketType = z.infer<typeof TicketTypeSchema>;

export const JudgeRequestSchema = z.object({
  // これまでに解釈済みの観測
  observations: z.array(ObservationSchema),
  // 今回新たに持ち込まれた未解釈の入力
  newInput: RawInputSchema.nullable(),
  origin: PlaceSchema,
  destination: PlaceSchema,
  constraints: UserConstraintsSchema,
  language: LangSchema,
  // 判断の基準時刻。リプレイではシナリオ時刻
  now: IsoDateTimeSchema,
  // 車内の位置。省略すれば駅にいるとみなす
  trainPosition: TrainPositionSchema.optional(),
  // 入口で答えた原因。分からないと答えたときやリプレイでは省く
  cause: IncidentCauseSchema.optional(),
  // 入口で答えた受信の放送の有無。電車の中で答えたときだけ送る
  protectionBroadcast: ProtectionBroadcastSchema.optional(),
  // 入口で答えた乗車券の種類。振替輸送の対象かを決め、乗り換え先の費用に使う
  ticketType: TicketTypeSchema.optional(),
});
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;
