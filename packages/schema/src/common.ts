import { z } from "zod";

// 全境界で共有する部品

export const IdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "英小文字で始まる英小文字・数字・_ のみ");
export type Id = z.infer<typeof IdSchema>;

export const LocalizedTextSchema = z.strictObject({
  ja: z.string().min(1),
  en: z.string().min(1).optional(),
});
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export const NonNegativeIntSchema = z.number().int().nonnegative();

// 所要時間の分布（分）。p80 は p50 以上
export const DurationDistSchema = z
  .strictObject({
    p50: NonNegativeIntSchema,
    p80: NonNegativeIntSchema,
  })
  .refine((d) => d.p80 >= d.p50, { message: "p80 は p50 以上", path: ["p80"] });
export type DurationDist = z.infer<typeof DurationDistSchema>;

// オフセット必須の ISO 8601 日時
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const ObservableKindSchema = z.enum([
  "announcement",
  "signage",
  "station_broadcast",
  "weather",
  "train_movement",
]);
export type ObservableKind = z.infer<typeof ObservableKindSchema>;

export const LangSchema = z.enum(["ja", "en"]);
export type Lang = z.infer<typeof LangSchema>;

export const ActionSchema = z.enum(["wait", "switch", "hold"]);
export type Action = z.infer<typeof ActionSchema>;

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;
