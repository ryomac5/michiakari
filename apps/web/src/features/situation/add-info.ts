import {
  type AnnouncementCueId,
  findIncidentType,
  findIncidentTypeGroup,
  INCIDENT_GROUP_IDS,
  type IncidentTypeId,
} from "@repo/core";
import type { Observation, RawInput } from "@repo/schema";
import type { AddedAnswers } from "./added-answers";
import {
  type AskedKindId,
  type CauseAnswer,
  type CauseChoiceId,
  type CauseKindId,
  causeCategoryIds,
  isAskedKind,
  resolveCauseIncidentType,
  toCauseChoiceId,
} from "./cause-categories";

// 判断の画面の「選んで答える」。原因が決まっていれば、原因の代わりに判断を変える手がかりを先に聞く

// 決まっている原因。eventType は選んだ手がかりと一緒に送る事象の種類か大分類の id
export type KnownCause = { eventType: string; label: CauseLabel };

// 札に出す原因の名前。causes は最初の選択肢、causeKinds は続けて聞く種類の訳語の key
export type CauseLabel =
  | { scope: "causes"; id: CauseChoiceId }
  | { scope: "causeKinds"; id: AskedKindId };

// 天気は種類まで分かれば種類の名前、分からなければ大分類の名前にする
export function selectCauseLabel(answer: CauseAnswer): CauseLabel | null {
  if (answer.category === "weather" && isAskedKind(answer.kind) && answer.kind !== "other") {
    return { scope: "causeKinds", id: answer.kind };
  }
  const choice = toCauseChoiceId(answer);
  return choice ? { scope: "causes", id: choice } : null;
}

const kindByIncidentType: Partial<Record<IncidentTypeId, CauseKindId>> = {
  person_collision: "person",
  medical_response: "inCar",
  heavy_rain: "rain",
  strong_wind: "wind",
  snow_ice: "snow",
  lightning: "lightning",
  earthquake: "earthquake",
};

// 観測の事象の id を入口の答えの形にする。種類の id でも大分類の id でもない id は null
export function toCauseAnswerFromEventType(eventType: string): CauseAnswer | null {
  const group = INCIDENT_GROUP_IDS.find((g) => g === eventType);
  if (group) return { category: group, kind: null };
  const type = findIncidentType(eventType);
  if (!type) return null;
  const category = causeCategoryIds.find((c) => c === findIncidentTypeGroup(type)) ?? null;
  return { category, kind: kindByIncidentType[type] ?? null };
}

function fromAnswer(answer: CauseAnswer | null): KnownCause | null {
  if (!answer?.category) return null;
  const label = selectCauseLabel(answer);
  if (!label) return null;
  return { eventType: resolveCauseIncidentType(answer) ?? answer.category, label };
}

function fromObservation(o: Observation): KnownCause | null {
  for (const c of o.eventTypeCandidates) {
    const answer = toCauseAnswerFromEventType(c.eventType);
    const label = answer ? selectCauseLabel(answer) : null;
    if (label) return { eventType: c.eventType, label };
  }
  return null;
}

function findLatestCause(observations: readonly Observation[]): KnownCause | null {
  for (const o of [...observations].reverse()) {
    const known = fromObservation(o);
    if (known) return known;
  }
  return null;
}

export type KnownCauseInput = {
  // 判断の画面で答えた原因。答えていなければ null
  answeredCause: CauseAnswer | null;
  // これまでの観測。古い順
  observations: readonly Observation[];
};

// 原因が決まっているか。答えた原因、選んで送った原因、発表から読んだ原因の順に使う
export function resolveKnownCause(input: KnownCauseInput): KnownCause | null {
  const selected = input.observations.filter((o) => o.source === "selection");
  return (
    fromAnswer(input.answeredCause) ??
    findLatestCause(selected) ??
    findLatestCause(input.observations)
  );
}

// 原因が決まっているときに出す放送の手がかり。押せばそのまま送る。どこにいても聞くものを先に並べる
const commonCueIds = ["resume_soon", "resumed", "inspection_ongoing"] as const;
const inCarCueIds = ["proceed_to_station", "evacuation_on_track"] as const;
const stationCueIds = ["turnback"] as const;

export type AddInfoCueId =
  | (typeof commonCueIds)[number]
  | (typeof inCarCueIds)[number]
  | (typeof stationCueIds)[number];

export function listAddInfoCues(inCar: boolean): AddInfoCueId[] {
  return [...commonCueIds, ...(inCar ? inCarCueIds : stationCueIds)];
}

// 足せる項目。まだ答えていないものだけを並べる。原因は別に扱う
// 受信の放送は車内の人だけ、区間は路線が分かっているときだけ聞く
const addableItemOrder = ["resume", "elapsed", "protection", "section", "ticket"] as const;
export type AddableItemId = (typeof addableItemOrder)[number];

export type AddableContext = { answers: AddedAnswers; onTrain: boolean; hasLine: boolean };

export function listAddableItems(ctx: AddableContext): AddableItemId[] {
  return addableItemOrder.filter((id) => {
    if (id === "protection" && !ctx.onTrain) return false;
    if (id === "section" && !ctx.hasLine) return false;
    return ctx.answers[id] === null;
  });
}

// 答えた項目。札に出し、押せば選び直す。原因は決まっている原因の札で出す
export function listAnsweredItems(answers: AddedAnswers): AddableItemId[] {
  return addableItemOrder.filter((id) => answers[id] !== null);
}

// 最初に出す選択肢。原因が決まっていれば放送の手がかり、決まっていなければ原因
export type AddInfoChoices =
  | { kind: "cause" }
  | { kind: "cues"; cause: KnownCause; cues: AddInfoCueId[] };

export function selectAddInfoChoices(known: KnownCause | null, inCar: boolean): AddInfoChoices {
  return known ? { kind: "cues", cause: known, cues: listAddInfoCues(inCar) } : { kind: "cause" };
}

// 手がかりを、決まっている原因の選択の入力にする
export function buildCueInput(known: KnownCause, cue: AnnouncementCueId): RawInput {
  return { type: "selection", eventType: known.eventType, signalIds: [cue] };
}
