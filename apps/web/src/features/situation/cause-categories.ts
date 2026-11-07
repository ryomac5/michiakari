import { type IncidentGroupId, type IncidentTypeId, resolveIncidentType } from "@repo/core";
import type { IncidentCause } from "@repo/schema";

// 入口で聞く原因の大分類と、判断で使う事象の種類の対応。対応はこの 1 か所にまとめる
// 大分類は docs/research/rail-suspensions/taxonomy.json の 8 大分類にそろえる
// 種類は packages/core の IncidentTypeId。大分類の中で種類が決まらなければ種類なしとし、統計値の大分類で見込む
// 人身事故と車内の急病人は事象の大きさが違うので、統計の大分類は人・旅客対応のまま、画面の最初の選択肢だけ分ける
// 気象・自然だけは種類を 1 問聞いて絞る

export const causeCategoryIds = [
  "passenger",
  "vehicle",
  "signaling",
  "power",
  "obstruction",
  "infrastructure",
  "weather",
  "major_accident",
] as const;
export type CauseCategoryId = (typeof causeCategoryIds)[number];

export const causeKindIds = [
  "person",
  "inCar",
  "rain",
  "wind",
  "snow",
  "lightning",
  "earthquake",
  "other",
] as const;
export type CauseKindId = (typeof causeKindIds)[number];
// 続けて聞く種類。人身事故と車内の急病人は最初の選択肢で選ぶので含めない
export type AskedKindId = Exclude<CauseKindId, "person" | "inCar">;

export function isAskedKind(kind: CauseKindId | null): kind is AskedKindId {
  return kind !== null && kind !== "person" && kind !== "inCar";
}

// incidentType は packages/core/params/incident-durations.ts の種類の id。対応する種類が無ければ null
type CauseKind = { id: CauseKindId; incidentType: IncidentTypeId | null };
type CauseCategory = {
  id: CauseCategoryId;
  // 種類を聞かずに決まる種類。統計値は大分類のまま使い、判断に送る事象の種類だけに使う
  incidentType?: IncidentTypeId;
  kinds?: CauseKind[];
  // 種類を最初の選択肢で選び終えているときは、続けて聞かない
  kindChosenFirst?: boolean;
};

const causeCategories: Record<CauseCategoryId, CauseCategory> = {
  // 人との接触と車内の対応は事象が違う。立ち入りや不審物は選択肢に無く、種類なしになる
  passenger: {
    id: "passenger",
    kindChosenFirst: true,
    kinds: [
      { id: "person", incidentType: "person_collision" },
      { id: "inCar", incidentType: "medical_response" },
    ],
  },
  // 故障と発煙の確認は、どちらも車両故障の種類に寄せる
  vehicle: { id: "vehicle", incidentType: "vehicle_failure" },
  signaling: { id: "signaling" },
  power: { id: "power" },
  obstruction: { id: "obstruction" },
  infrastructure: { id: "infrastructure" },
  weather: {
    id: "weather",
    kinds: [
      { id: "rain", incidentType: "heavy_rain" },
      { id: "wind", incidentType: "strong_wind" },
      { id: "snow", incidentType: "snow_ice" },
      { id: "lightning", incidentType: "lightning" },
      { id: "earthquake", incidentType: "earthquake" },
      { id: "other", incidentType: null },
    ],
  },
  major_accident: { id: "major_accident" },
};

// 入口の答え。分からないなら category は null。種類を聞かない大分類では kind は null
export type CauseAnswer = { category: CauseCategoryId | null; kind: CauseKindId | null };

// 画面の最初の選択肢。利用者がよく聞く順に、人身事故、車内の急病人を先頭に置く
export const causeChoiceIds = [
  "person",
  "inCar",
  "vehicle",
  "signaling",
  "power",
  "obstruction",
  "infrastructure",
  "weather",
  "major_accident",
] as const;
export type CauseChoiceId = (typeof causeChoiceIds)[number];

export function toCauseAnswer(choice: CauseChoiceId): CauseAnswer {
  return choice === "person" || choice === "inCar"
    ? { category: "passenger", kind: choice }
    : { category: choice, kind: null };
}

// 答えを、画面で選んだ選択肢の id に戻す。分からないは null
export function toCauseChoiceId(answer: CauseAnswer): CauseChoiceId | null {
  if (!answer.category) return null;
  if (answer.category !== "passenger") return answer.category;
  return answer.kind === "person" || answer.kind === "inCar" ? answer.kind : null;
}

export function needsCauseKind(category: CauseCategoryId): boolean {
  const { kinds, kindChosenFirst } = causeCategories[category];
  return kinds !== undefined && !kindChosenFirst;
}

export function listCauseKinds(category: CauseCategoryId): AskedKindId[] {
  return needsCauseKind(category)
    ? (causeCategories[category].kinds ?? []).map((k) => k.id).filter(isAskedKind)
    : [];
}

// 答えから判断に送る事象の種類を引く。種類が決まらない答えは null
export function resolveCauseIncidentType(answer: CauseAnswer | null): IncidentTypeId | null {
  if (!answer?.category) return null;
  return resolveIncidentType({
    eventType: causeCategories[answer.category].incidentType ?? null,
    cause: resolveIncidentCause(answer),
  });
}

// 答えを統計値の大分類と種類にする。大分類の id は統計値の大分類と同じ。分からないは null
// 種類を聞かない大分類や「その他」では、種類を null にして大分類の値を使わせる
export function resolveIncidentCause(answer: CauseAnswer | null): IncidentCause | null {
  if (!answer?.category) return null;
  const kinds = causeCategories[answer.category].kinds;
  const type = kinds?.find((k) => k.id === answer.kind)?.incidentType ?? null;
  const group: IncidentGroupId = answer.category;
  return { group, type };
}
