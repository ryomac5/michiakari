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

// 判断に使った気象。雨量の推移と警報を画面に出す
export const MAX_WEATHER_READINGS = 36;
export const MAX_WEATHER_SPAN_MINUTES = 360;

export const WeatherCheckedReadingSchema = z.object({
  time: IsoDateTimeSchema,
  // 欠測は null
  rainfall10minMm: z.number().nonnegative().nullable(),
});
export type WeatherCheckedReading = z.infer<typeof WeatherCheckedReadingSchema>;

export const WeatherTrendSchema = z.enum(["rising", "falling", "steady", "unknown"]);
export type WeatherTrend = z.infer<typeof WeatherTrendSchema>;

// 時刻の昇順で、最初から最後までが 6 時間以内
function checkReadingsSpan(readings: readonly WeatherCheckedReading[]): boolean {
  const times = readings.map((r) => Date.parse(r.time));
  const ascending = times.every((t, i) => i === 0 || t > (times[i - 1] ?? t));
  const first = times[0];
  const last = times.at(-1);
  const span = first === undefined || last === undefined ? 0 : (last - first) / 60_000;
  return ascending && span <= MAX_WEATHER_SPAN_MINUTES;
}

export const WeatherCheckedEventSchema = defineEvent("weather_checked", {
  source: z.enum(["scenario", "jma"]),
  readings: z
    .array(WeatherCheckedReadingSchema)
    .max(MAX_WEATHER_READINGS)
    .refine(checkReadingsSpan, "readings は時刻の昇順で、6 時間以内に収める"),
  warnings: z.array(z.string()),
  trend: WeatherTrendSchema,
  summary: z.string().min(1),
});

export const JudgmentReadyEventSchema = defineEvent("judgment_ready", {
  judgment: JudgmentSchema,
});

export const ErrorEventSchema = defineEvent("error", {
  message: z.string(),
  retryable: z.boolean(),
});

// 判断の途中経過。画面に短い一文で出す
export const ProgressStageSchema = z.enum([
  "interpret",
  "knowledge",
  "weather",
  "phase",
  "alternatives",
  "break_even",
  "judgment",
]);
export type ProgressStage = z.infer<typeof ProgressStageSchema>;

export const ProgressEventSchema = defineEvent("progress", {
  message: z.string().min(1),
  stage: ProgressStageSchema.optional(),
});

export const JudgmentEventSchema = z.discriminatedUnion("type", [
  ObservationParsedEventSchema,
  SignalDetectedEventSchema,
  PhaseEstimatedEventSchema,
  AlternativesComputedEventSchema,
  BreakEvenComputedEventSchema,
  JudgmentReadyEventSchema,
  ErrorEventSchema,
  ProgressEventSchema,
  WeatherCheckedEventSchema,
]);
export type JudgmentEvent = z.infer<typeof JudgmentEventSchema>;
export type JudgmentEventType = JudgmentEvent["type"];
// type を指定して個別のイベント型を取り出す
export type JudgmentEventOf<T extends JudgmentEventType> = Extract<JudgmentEvent, { type: T }>;
