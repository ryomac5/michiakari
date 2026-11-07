import type {
  IncidentCause,
  Observation,
  ProtectionBroadcast,
  RawInput,
  Section,
  TicketType,
} from "@repo/schema";
import { entryLineObservationId } from "@/features/entry/seed";
import { formatIsoWithOffset } from "@/features/judgment/time";
import {
  type CauseAnswer,
  resolveCauseIncidentType,
  resolveIncidentCause,
} from "./cause-categories";
import { type ElapsedOption, findElapsedOption, type ResumeOptionId } from "./plain-questions";
import {
  buildProtectionObservations,
  type ProtectionAnswer,
  protectionObservationId,
  resolveProtectionBroadcast,
} from "./protection-broadcast";
import { type TicketAnswer, toTicketType } from "./ticket";

// 判断の画面の「情報を追加する」で足した答え。分かったときに 1 つずつ足し、札で直せる

// 再開見込みの答え。時刻を言っていたときだけ iso を持つ
export type ResumeAnswer = { id: ResumeOptionId; iso: string | null };

export type AddedAnswers = {
  cause: CauseAnswer | null;
  elapsed: ElapsedOption["id"] | null;
  protection: ProtectionAnswer | null;
  resume: ResumeAnswer | null;
  ticket: TicketAnswer | null;
  section: Section | null;
};

export const emptyAddedAnswers: AddedAnswers = {
  cause: null,
  elapsed: null,
  protection: null,
  resume: null,
  ticket: null,
  section: null,
};

export const addedItemIds = [
  "cause",
  "elapsed",
  "protection",
  "resume",
  "ticket",
  "section",
] as const;
export type AddedItemId = (typeof addedItemIds)[number];

export const sectionObservationId = "added-section";

// 足した区間を、利用者が選んだ止まっている区間の観測にする
function buildSectionObservation(
  section: Section,
  line: Observation | undefined,
  now: Date,
): Observation {
  return {
    id: sectionObservationId,
    observedAt: formatIsoWithOffset(now),
    source: "selection",
    eventTypeCandidates: [],
    operator: line?.operator ?? null,
    line: line?.line ?? null,
    section,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

// 止まってからの分は、路線の観測を見た時刻を前にずらして伝える。再開見込みの時刻もこの観測に載せる
// 変えた答えだけを映す。ほかの答えを足すたびに見た時刻がずれないようにする
function applyLineAnswers(
  line: Observation,
  changed: Partial<AddedAnswers>,
  now: Date,
): Observation {
  const minutes = changed.elapsed ? findElapsedOption(changed.elapsed).minutes : null;
  return {
    ...line,
    ...(minutes !== null
      ? { observedAt: formatIsoWithOffset(new Date(now.getTime() - minutes * 60_000)) }
      : {}),
    ...(changed.resume ? { statedResumeTime: changed.resume.iso } : {}),
  };
}

// 原因だけを選んだ観測。原因を選び直したら、前に選んだ原因を残さない
function checkCauseSelection(o: Observation): boolean {
  return (
    o.source === "selection" && o.eventTypeCandidates.length > 0 && o.detectedSignals.length === 0
  );
}

// 変えた答えを観測の列に映す。路線の観測を直し、受信の放送と区間の観測を差し替える
// answers は変えた後の答えの全体、changed はこのとき変えた答え
export function applyAddedAnswers(
  observations: readonly Observation[],
  answers: AddedAnswers,
  changed: Partial<AddedAnswers>,
  now: Date,
): Observation[] {
  const line = observations.find((o) => o.id === entryLineObservationId);
  const lined = observations.map((o) =>
    o.id === entryLineObservationId ? applyLineAnswers(o, changed, now) : o,
  );
  const causeChanged = "cause" in changed;
  const protectionChanged = "protection" in changed;
  const sectionChanged = "section" in changed;
  const elapsedMinutes = answers.elapsed ? findElapsedOption(answers.elapsed).minutes : null;
  return [
    ...lined.filter(
      (o) =>
        !(causeChanged && checkCauseSelection(o)) &&
        !(protectionChanged && o.id === protectionObservationId) &&
        !(sectionChanged && o.id === sectionObservationId),
    ),
    ...(protectionChanged
      ? buildProtectionObservations(answers.protection, now, elapsedMinutes)
      : []),
    ...(sectionChanged && answers.section
      ? [buildSectionObservation(answers.section, line, now)]
      : []),
  ];
}

// 判断の要求に毎回入れる値。原因、受信の放送、乗車券の種類
export type AnswerRequestValues = {
  cause: IncidentCause | null;
  protectionBroadcast: ProtectionBroadcast | null;
  ticketType: TicketType | null;
};

export function resolveAnswerRequestValues(answers: AddedAnswers): AnswerRequestValues {
  return {
    cause: resolveIncidentCause(answers.cause),
    protectionBroadcast: resolveProtectionBroadcast(answers.protection),
    ticketType: answers.ticket ? toTicketType(answers.ticket) : null,
  };
}

// 原因を足したときだけ、種類の決まる原因を選択の入力として送る
export function buildCauseInput(cause: CauseAnswer | null): RawInput | null {
  const eventType = resolveCauseIncidentType(cause);
  return eventType ? { type: "selection", eventType, signalIds: [] } : null;
}
