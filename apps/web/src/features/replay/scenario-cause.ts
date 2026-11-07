import {
  type CauseAnswer,
  causeChoiceIds,
  isAskedKind,
  listCauseKinds,
  resolveIncidentCause,
  toCauseAnswer,
  toCauseChoiceId,
} from "@/features/situation/cause-categories";

// シナリオの事象を、入口と同じ原因の表の呼び名にする。知見の事象名は使わない

// 事象の id が統計値の種類の id にそろうまでの読み替え
// TODO: シナリオの event_type が IncidentTypeId にそろったら外す
const causeByLegacyEventType: Readonly<Record<string, CauseAnswer>> = {
  person_accident: toCauseAnswer("person"),
  in_car_response: toCauseAnswer("inCar"),
  vehicle_failure: toCauseAnswer("vehicle"),
  heavy_rain: { category: "weather", kind: "rain" },
};

// 原因の表の答えをすべて並べる。種類を聞く大分類は種類ごとに分ける
function listCauseAnswers(): CauseAnswer[] {
  return causeChoiceIds.flatMap((choice) => {
    const answer = toCauseAnswer(choice);
    const kinds = answer.category ? listCauseKinds(answer.category) : [];
    return kinds.length === 0 ? [answer] : kinds.map((kind) => ({ ...answer, kind }));
  });
}

// 事象の id から原因の表の答えを引く。種類の id と一致する答えを先に使う
export function findScenarioCause(eventType: string): CauseAnswer | null {
  const legacy = causeByLegacyEventType[eventType];
  if (legacy) return legacy;
  return listCauseAnswers().find((a) => resolveIncidentCause(a)?.type === eventType) ?? null;
}

// 原因の答えを、入口の訳の鍵にする。種類を聞いた答えは種類の呼び名を使う
export function selectCauseLabelKey(answer: CauseAnswer): string | null {
  if (isAskedKind(answer.kind) && answer.kind !== "other") return `causeKinds.${answer.kind}`;
  const choice = toCauseChoiceId(answer);
  return choice ? `causes.${choice}` : null;
}
