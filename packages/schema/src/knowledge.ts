import { z } from "zod";
import {
  DurationDistSchema,
  IdSchema,
  LocalizedTextSchema,
  ObservableKindSchema,
} from "./common.ts";
import { findDuplicateIds } from "./internal.ts";

// knowledge/*.yaml の書式。キーは雛形どおり snake_case

export const KnowledgeSignalSchema = z.strictObject({
  id: IdSchema,
  observable_from: z.array(ObservableKindSchema).min(1),
  description: z.string(),
  example_phrases: z.array(z.string()),
});
export type KnowledgeSignal = z.infer<typeof KnowledgeSignalSchema>;

export const KnowledgePhaseSchema = z.strictObject({
  id: IdSchema,
  name: LocalizedTextSchema,
  description: z.string(),
  signals: z.array(KnowledgeSignalSchema),
  duration_minutes: DurationDistSchema,
  exit_signals: z.array(IdSchema),
  guidance: LocalizedTextSchema,
});
export type KnowledgePhase = z.infer<typeof KnowledgePhaseSchema>;

export const KnowledgeSchema = z.strictObject({
  id: IdSchema,
  name: LocalizedTextSchema,
  summary: LocalizedTextSchema,
  identification: z.strictObject({
    phrases: z.array(z.string()),
  }),
  phases: z.array(KnowledgePhaseSchema).min(1),
  after_resume: z.strictObject({
    first_train_wait_minutes: DurationDistSchema,
    notes: z.string(),
  }),
  caveats: z.array(z.string()),
  external_factors: z.strictObject({
    weather: z.boolean(),
    notes: z.string(),
  }),
});
export type Knowledge = z.infer<typeof KnowledgeSchema>;

// ファイル内の ID 整合性を検査し、問題をエラー文字列で返す
export function checkKnowledgeIntegrity(k: Knowledge): string[] {
  const errors: string[] = [];

  for (const id of findDuplicateIds(k.phases.map((p) => p.id))) {
    errors.push(`phase id が重複しています: ${id}`);
  }

  const signalIds = k.phases.flatMap((p) => p.signals.map((s) => s.id));
  for (const id of findDuplicateIds(signalIds)) {
    errors.push(`signal id が重複しています: ${id}`);
  }

  const known = new Set(signalIds);
  for (const phase of k.phases) {
    for (const exit of phase.exit_signals) {
      if (!known.has(exit)) {
        errors.push(`phase ${phase.id} の exit_signals が未定義の signal を指しています: ${exit}`);
      }
    }
  }

  return errors;
}
