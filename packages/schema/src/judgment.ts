import { z } from "zod";
import {
  ActionSchema,
  ConfidenceSchema,
  DurationDistSchema,
  IdSchema,
  IsoDateTimeSchema,
  NonNegativeIntSchema,
} from "./common.ts";

// emit_judgment の出力。Claude のツール定義に変換するため refine で ID 参照を検査しない

export const RouteLegSchema = z.object({
  mode: z.enum(["walk", "ride", "wait", "taxi"]),
  from: z.string(),
  to: z.string(),
  minutes: NonNegativeIntSchema,
  line: z.string().optional(),
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

export const BreakEvenSchema = z.object({
  time: IsoDateTimeSchema,
  explanation: z.string(),
});
export type BreakEven = z.infer<typeof BreakEvenSchema>;

export const EstimateSchema = z.object({
  eventType: IdSchema,
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
  breakEven: BreakEvenSchema.nullable(),
  estimate: EstimateSchema,
  options: z.array(RouteOptionSchema),
  recommendedOptionId: IdSchema.nullable(),
  evidence: z.array(EvidenceSchema),
  disclaimer: z.string().min(1),
});
export type Judgment = z.infer<typeof JudgmentSchema>;

// 推奨する代替手段の参照を検査し、問題をエラー文字列で返す
export function checkJudgmentRefs(j: Judgment): string[] {
  const errors: string[] = [];

  if (j.action === "switch" && j.recommendedOptionId === null) {
    errors.push("action が switch のときは recommendedOptionId が必要です");
  }

  if (j.recommendedOptionId !== null && !j.options.some((o) => o.id === j.recommendedOptionId)) {
    errors.push(`recommendedOptionId が options に存在しません: ${j.recommendedOptionId}`);
  }

  return errors;
}
