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
});
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;
