import { z } from "zod";
import {
  ConfidenceSchema,
  IdSchema,
  IsoDateTimeSchema,
  LocalizedTextSchema,
  ObservableKindSchema,
} from "./common.ts";

// 利用者が持ち込む未解釈の入力

export const ImageMediaTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const PhotoInputSchema = z.object({
  type: z.literal("photo"),
  imageBase64: z.string().min(1),
  mediaType: ImageMediaTypeSchema,
});

export const TextInputSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
});

export const SelectionInputSchema = z.object({
  type: z.literal("selection"),
  eventType: IdSchema,
  signalIds: z.array(IdSchema),
});

// リプレイでシナリオの timeline 1件を流し込む
export const ScenarioInputSchema = z.object({
  type: z.literal("scenario"),
  // weather.readings を引くシナリオを特定する
  scenarioId: IdSchema,
  observationId: IdSchema,
  kind: ObservableKindSchema,
  text: LocalizedTextSchema,
});

export const RawInputSchema = z.discriminatedUnion("type", [
  PhotoInputSchema,
  TextInputSchema,
  SelectionInputSchema,
  ScenarioInputSchema,
]);
export type RawInput = z.infer<typeof RawInputSchema>;

// interpret_observation が返す解釈済みの観測

export const ObservationSourceSchema = z.enum(["photo", "text", "selection", "scenario"]);
export type ObservationSource = z.infer<typeof ObservationSourceSchema>;

export const SectionSchema = z.object({
  fromStation: z.string(),
  toStation: z.string(),
});
export type Section = z.infer<typeof SectionSchema>;

export const EventTypeCandidateSchema = z.object({
  eventType: IdSchema,
  confidence: ConfidenceSchema,
});
export type EventTypeCandidate = z.infer<typeof EventTypeCandidateSchema>;

export const DetectedSignalSchema = z.object({
  eventType: IdSchema,
  signalId: IdSchema,
  quote: z.string(),
});
export type DetectedSignal = z.infer<typeof DetectedSignalSchema>;

export const ObservationSchema = z.object({
  id: z.string().min(1),
  observedAt: IsoDateTimeSchema,
  source: ObservationSourceSchema,
  kind: ObservableKindSchema.optional(),
  rawText: z.string().optional(),
  eventTypeCandidates: z.array(EventTypeCandidateSchema),
  operator: z.string().nullable(),
  line: z.string().nullable(),
  section: SectionSchema.nullable(),
  statedResumeTime: IsoDateTimeSchema.nullable(),
  transferServiceActive: z.boolean().nullable(),
  detectedSignals: z.array(DetectedSignalSchema),
});
export type Observation = z.infer<typeof ObservationSchema>;
