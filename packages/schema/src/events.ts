import { z } from "zod";
import { IsoDateTimeSchema, NonNegativeIntSchema } from "./common.ts";
import { BreakEvenSchema, EstimateSchema, JudgmentSchema, RouteOptionSchema } from "./judgment.ts";
import { DetectedSignalSchema, ObservationSchema } from "./observation.ts";

// SSE で送る判断イベント。種類を足すときは defineEvent で作り JudgmentEventSchema に並べる

const EventBaseShape = {
  seq: NonNegativeIntSchema,
  at: IsoDateTimeSchema,
};

function defineEvent<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ type: z.literal(type), ...EventBaseShape, ...shape });
}

export const ObservationParsedEventSchema = defineEvent("observation_parsed", {
  observation: ObservationSchema,
});

export const SignalDetectedEventSchema = defineEvent("signal_detected", {
  signal: DetectedSignalSchema,
});

export const PhaseEstimatedEventSchema = defineEvent("phase_estimated", {
  estimate: EstimateSchema,
});

export const AlternativesComputedEventSchema = defineEvent("alternatives_computed", {
  options: z.array(RouteOptionSchema),
});

export const BreakEvenComputedEventSchema = defineEvent("break_even_computed", {
  breakEven: BreakEvenSchema.nullable(),
});

export const JudgmentReadyEventSchema = defineEvent("judgment_ready", {
  judgment: JudgmentSchema,
});

export const ErrorEventSchema = defineEvent("error", {
  message: z.string(),
  retryable: z.boolean(),
});

export const JudgmentEventSchema = z.discriminatedUnion("type", [
  ObservationParsedEventSchema,
  SignalDetectedEventSchema,
  PhaseEstimatedEventSchema,
  AlternativesComputedEventSchema,
  BreakEvenComputedEventSchema,
  JudgmentReadyEventSchema,
  ErrorEventSchema,
]);
export type JudgmentEvent = z.infer<typeof JudgmentEventSchema>;
export type JudgmentEventType = JudgmentEvent["type"];
// type を指定して個別のイベント型を取り出す
export type JudgmentEventOf<T extends JudgmentEventType> = Extract<JudgmentEvent, { type: T }>;
