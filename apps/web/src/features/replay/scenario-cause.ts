import { resolveIncidentType } from "@repo/core";
import {
  type CauseAnswer,
  causeChoiceIds,
  isAskedKind,
  listCauseKinds,
  resolveCauseIncidentType,
  toCauseAnswer,
  toCauseChoiceId,
} from "@/features/situation/cause-categories";

// シナリオの事象を、入口と同じ原因の表の呼び名にする。事象の id は core の resolveIncidentType で種類にそろえる

// 原因の表の答えをすべて並べる。種類を聞く大分類は種類ごとに分ける
function listCauseAnswers(): CauseAnswer[] {
  return causeChoiceIds.flatMap((choice) => {
    const answer = toCauseAnswer(choice);
    const kinds = answer.category ? listCauseKinds(answer.category) : [];
    return kinds.length === 0 ? [answer] : kinds.map((kind) => ({ ...answer, kind }));
  });
}

// 事象の id から原因の表の答えを引く。種類が決まらなければ null
export function findScenarioCause(eventType: string): CauseAnswer | null {
  const type = resolveIncidentType({ eventType });
  if (type === null) return null;
  return listCauseAnswers().find((a) => resolveCauseIncidentType(a) === type) ?? null;
}

// 原因の答えを、入口の訳の鍵にする。種類を聞いた答えは種類の呼び名を使う
export function selectCauseLabelKey(answer: CauseAnswer): string | null {
  if (isAskedKind(answer.kind) && answer.kind !== "other") return `causeKinds.${answer.kind}`;
  const choice = toCauseChoiceId(answer);
  return choice ? `causes.${choice}` : null;
}
