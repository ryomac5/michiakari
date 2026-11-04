import { z } from "zod";
import { IsoDateTimeSchema, LangSchema } from "./common.ts";
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

// 列車の種別。入口の選択肢と同じ 5 値。unknown は普通として控えめに扱う
export const TrainTypeSchema = z.enum([
  "local",
  "rapid",
  "special_rapid",
  "limited_express",
  "unknown",
]);
export type TrainType = z.infer<typeof TrainTypeSchema>;

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
});
export type TrainPosition = z.infer<typeof TrainPositionSchema>;

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
});
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;
