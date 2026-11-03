import { z } from "zod";
import {
  DurationDistSchema,
  IdSchema,
  LocalizedTextSchema,
  NonNegativeIntSchema,
} from "./common.ts";
import { PredictabilityLevelSchema } from "./knowledge.ts";

// 事象ごとの「よくある流れ」と「見込みの立てやすさ」。packages/core の describeTypicalFlow の出力

export const TypicalFlowPhaseSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  duration: DurationDistSchema,
});
export type TypicalFlowPhase = z.infer<typeof TypicalFlowPhaseSchema>;

// source は、知見に書かれていたか、再開までの p80 と p50 の比から推し量ったか
export const TypicalFlowPredictabilitySchema = z.object({
  level: PredictabilityLevelSchema,
  source: z.enum(["knowledge", "inferred"]),
  basis: LocalizedTextSchema.nullable(),
});
export type TypicalFlowPredictability = z.infer<typeof TypicalFlowPredictabilitySchema>;

export const TypicalFlowSchema = z.object({
  eventType: IdSchema,
  phases: z.array(TypicalFlowPhaseSchema).min(1),
  // 発生から運転再開まで。再開後の初列車待ちを含まない
  untilResume: DurationDistSchema,
  // 運転再開から実際に乗れる列車が来るまで
  firstTrainWait: DurationDistSchema,
  predictability: TypicalFlowPredictabilitySchema,
  typicalFloorMinutes: NonNegativeIntSchema.nullable(),
});
export type TypicalFlow = z.infer<typeof TypicalFlowSchema>;
