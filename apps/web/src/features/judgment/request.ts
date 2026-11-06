import {
  type IncidentCause,
  type JudgeRequest,
  JudgeRequestSchema,
  type Lang,
  type Observation,
  type Place,
  type RawInput,
  type TrainPosition,
  type UserConstraints,
} from "@repo/schema";
import { formatIsoWithOffset } from "./time";

// POST /judge の要求を組み立てる。送る前に境界で検証する

export const defaultConstraints: UserConstraints = {
  deadline: null,
  knowsAlternatives: false,
  mobilityNotes: null,
};

export type JudgeRequestParams = {
  observations: Observation[];
  newInput: RawInput | null;
  origin: Place;
  destination: Place;
  language: Lang;
  now: Date;
  constraints?: UserConstraints;
  // 車内の位置。無ければ送らず、駅にいるとみなされる
  trainPosition?: TrainPosition | null;
  // 入口で答えた原因。無ければ送らない
  cause?: IncidentCause | null;
};

export function buildJudgeRequest(params: JudgeRequestParams): JudgeRequest {
  return JudgeRequestSchema.parse({
    observations: params.observations,
    newInput: params.newInput,
    origin: params.origin,
    destination: params.destination,
    constraints: params.constraints ?? defaultConstraints,
    language: params.language,
    now: formatIsoWithOffset(params.now),
    ...(params.trainPosition ? { trainPosition: params.trainPosition } : {}),
    ...(params.cause ? { cause: params.cause } : {}),
  });
}
