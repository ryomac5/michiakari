import { z } from "zod";
import {
  ActionSchema,
  IdSchema,
  IsoDateTimeSchema,
  LangSchema,
  LocalizedTextSchema,
  NonNegativeIntSchema,
  ObservableKindSchema,
} from "./common.ts";
import { findDuplicateIds } from "./internal.ts";

// scenarios/*.yaml の書式。キーは雛形どおり snake_case

export const HhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 形式");

export const ScenarioUserSchema = z.strictObject({
  current_station: z.string(),
  destination: z.string(),
  constraints: z.strictObject({
    deadline: HhmmSchema.nullable(),
    knows_alternatives: z.boolean(),
    mobility_notes: z.string().nullable(),
  }),
  language: LangSchema,
});
export type ScenarioUser = z.infer<typeof ScenarioUserSchema>;

export const TimelineEntrySchema = z.strictObject({
  id: IdSchema,
  offset_minutes: NonNegativeIntSchema,
  kind: ObservableKindSchema,
  text: LocalizedTextSchema,
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

// 期待する振る舞い。検査項目が一つもない要素は拒否する
// phase は以前の雛形との互換のため受け付けるが、判断は段階を持たないので検査しない
// evidence_includes は放送の手がかりの id（ANNOUNCEMENT_CUE_IDS）で、判断の根拠の cue と照合する
export const ExpectationSchema = z
  .strictObject({
    after: IdSchema,
    action: ActionSchema.optional(),
    phase: IdSchema.optional(),
    evidence_includes: z.array(IdSchema).optional(),
    break_even_shown: z.boolean().optional(),
    note: z.string(),
  })
  .refine(
    (e) =>
      e.action !== undefined ||
      e.phase !== undefined ||
      e.evidence_includes !== undefined ||
      e.break_even_shown !== undefined,
    { message: "action / phase / evidence_includes / break_even_shown のいずれかが必要" },
  );
export type Expectation = z.infer<typeof ExpectationSchema>;

// 大雨シナリオのリプレイで get_weather が返す観測値
export const WeatherReadingSchema = z.strictObject({
  offset_minutes: NonNegativeIntSchema,
  rainfall_10min_mm: z.number().nonnegative(),
  warnings: z.array(z.string()),
});
export type WeatherReading = z.infer<typeof WeatherReadingSchema>;

export const ScenarioSchema = z.strictObject({
  id: IdSchema,
  title: LocalizedTextSchema,
  // 統計値の種類の id（packages/core の IncidentTypeId）。照合は core を使う側が行う
  event_type: IdSchema,
  operator: z.string(),
  line: z.string(),
  blocked_section: z.strictObject({
    from_station: z.string(),
    to_station: z.string(),
  }),
  start_time: IsoDateTimeSchema,
  user: ScenarioUserSchema,
  timeline: z.array(TimelineEntrySchema).min(1),
  expectations: z.array(ExpectationSchema),
  ground_truth: z.strictObject({
    resume_offset_minutes: NonNegativeIntSchema.nullable(),
    notes: z.string(),
  }),
  weather: z
    .strictObject({
      readings: z.array(WeatherReadingSchema),
    })
    .optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

// ファイル内の ID 整合性と時刻順を検査し、問題をエラー文字列で返す
export function checkScenarioIntegrity(s: Scenario): string[] {
  const errors: string[] = [];

  for (const id of findDuplicateIds(s.timeline.map((t) => t.id))) {
    errors.push(`timeline id が重複しています: ${id}`);
  }

  s.timeline.forEach((entry, i) => {
    const prev = s.timeline[i - 1];
    if (prev && entry.offset_minutes < prev.offset_minutes) {
      errors.push(`timeline の offset_minutes が昇順ではありません: ${prev.id} → ${entry.id}`);
    }
  });

  const readings = s.weather?.readings ?? [];
  readings.forEach((reading, i) => {
    const prev = readings[i - 1];
    if (prev && reading.offset_minutes <= prev.offset_minutes) {
      errors.push(
        `weather.readings の offset_minutes が狭義の昇順ではありません: ${prev.offset_minutes} → ${reading.offset_minutes}`,
      );
    }
  });

  const known = new Set(s.timeline.map((t) => t.id));
  for (const e of s.expectations) {
    if (!known.has(e.after)) {
      errors.push(`expectations.after が未定義の timeline id を指しています: ${e.after}`);
    }
  }

  return errors;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// start_time 以降で最初に来る HH:MM（日本時間）を ISO 文字列で返す
// シナリオの deadline を JudgeRequest の IsoDateTime に変換する補助なので schema に置く
export function resolveDeadline(startTime: string, hhmm: string): string {
  const start = Date.parse(IsoDateTimeSchema.parse(startTime));
  const [hours, minutes] = HhmmSchema.parse(hhmm).split(":").map(Number) as [number, number];

  // 日本時間の壁時計を UTC 表現で扱う
  const startWall = new Date(start + JST_OFFSET_MS);
  let candidateWall = Date.UTC(
    startWall.getUTCFullYear(),
    startWall.getUTCMonth(),
    startWall.getUTCDate(),
    hours,
    minutes,
  );
  if (candidateWall - JST_OFFSET_MS < start) candidateWall += DAY_MS;

  return `${new Date(candidateWall).toISOString().slice(0, 19)}+09:00`;
}
